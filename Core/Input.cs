using System.Runtime.InteropServices;
using HidSharp;
using Nefarius.ViGEm.Client;
using Nefarius.ViGEm.Client.Targets;
using Nefarius.ViGEm.Client.Targets.Xbox360;

namespace MohammedLab.ColorVision.Core;

public static class MouseInjector
{
    private const uint MOVE = 0x0001, LEFTDOWN = 0x0002, LEFTUP = 0x0004;
    [DllImport("user32.dll")] private static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int vKey);
    public static bool IsDown(int virtualKey) => (GetAsyncKeyState(vKey: virtualKey) & 0x8000) != 0;
    public static void Move(int dx, int dy) { if (dx != 0 || dy != 0) mouse_event(MOVE, dx, dy, 0, UIntPtr.Zero); }
    public static void LeftDown() => mouse_event(LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
    public static void LeftUp() => mouse_event(LEFTUP, 0, 0, 0, UIntPtr.Zero);
}

public enum PhysicalControllerSource
{
    None,
    DualSenseUsb,
    XInput
}

public static class XInput
{
    [Flags]
    public enum Buttons : ushort
    {
        DPadUp = 0x0001, DPadDown = 0x0002, DPadLeft = 0x0004, DPadRight = 0x0008,
        Start = 0x0010, Back = 0x0020, LeftThumb = 0x0040, RightThumb = 0x0080,
        LeftShoulder = 0x0100, RightShoulder = 0x0200, A = 0x1000, B = 0x2000, X = 0x4000, Y = 0x8000
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct Gamepad
    {
        public Buttons wButtons;
        public byte bLeftTrigger;
        public byte bRightTrigger;
        public short sThumbLX;
        public short sThumbLY;
        public short sThumbRX;
        public short sThumbRY;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct State
    {
        public uint dwPacketNumber;
        public Gamepad Gamepad;
    }

    [DllImport("xinput1_4.dll", EntryPoint = "XInputGetState")]
    private static extern uint GetStateNative(uint dwUserIndex, out State pState);

    private static readonly DualSenseUsbReader DualSense = new();

    public static string ControllerName { get; private set; } = "None";
    public static PhysicalControllerSource ControllerSource { get; private set; } = PhysicalControllerSource.None;
    public static bool DualSenseUsbPresent => DualSense.IsPresent;
    public static bool DualSenseUsbConnected => DualSense.IsConnected;
    public static string DualSenseStatus => DualSense.Status;

    static XInput()
    {
        AppDomain.CurrentDomain.ProcessExit += (_, _) => DualSense.Dispose();
    }

    public static bool TryGetState(int index, out State state)
    {
        // A real DualSense connected by USB is always preferred over XInput.
        // This keeps the UI from mistaking our ViGEm virtual Xbox device for the physical pad.
        if (DualSense.TryGetState(out state))
        {
            ControllerName = "DualSense (USB)";
            ControllerSource = PhysicalControllerSource.DualSenseUsb;
            return true;
        }

        // If Windows can see a DualSense USB device but HID access is not ready/available,
        // do not silently fall through to a virtual XInput device and call it the user's pad.
        if (DualSense.IsPresent)
        {
            state = default;
            ControllerName = "DualSense (USB)";
            ControllerSource = PhysicalControllerSource.DualSenseUsb;
            return false;
        }

        try
        {
            if (GetStateNative((uint)Math.Clamp(index, 0, 3), out state) == 0)
            {
                ControllerName = "Xbox / XInput Controller";
                ControllerSource = PhysicalControllerSource.XInput;
                return true;
            }
        }
        catch (DllNotFoundException) { }
        catch (EntryPointNotFoundException) { }

        state = default;
        ControllerName = "None";
        ControllerSource = PhysicalControllerSource.None;
        return false;
    }

    public static bool TryGetDualSenseState(out State state) => DualSense.TryGetState(out state);

    public static void RescanController()
    {
        ControllerName = "Scanning…";
        ControllerSource = PhysicalControllerSource.None;
        DualSense.Rescan();
    }

    private sealed class DualSenseUsbReader : IDisposable
    {
        private const int SonyVendorId = 0x054C;
        private const int DualSenseProductId = 0x0CE6;
        private const int DualSenseEdgeProductId = 0x0DF2;

        private readonly object _sync = new();
        private readonly CancellationTokenSource _cts = new();
        private readonly Task _readerTask;
        private HidStream? _stream;
        private State _latestState;
        private DateTime _lastReportUtc;
        private uint _packetNumber;
        private volatile bool _connected;
        private volatile bool _present;
        private volatile bool _rescanRequested;
        private string _status = "Not detected";

        public bool IsPresent => _present;
        public bool IsConnected => _connected;
        public string Status
        {
            get { lock (_sync) return _status; }
        }

        public DualSenseUsbReader()
        {
            _readerTask = Task.Run(() => ReaderLoopAsync(_cts.Token));
        }

        public bool TryGetState(out State state)
        {
            lock (_sync)
            {
                // Opening the correct HID interface is sufficient to establish a physical USB
                // connection. Fresh reports replace the neutral initial state as they arrive.
                if (_connected)
                {
                    state = _latestState;
                    return true;
                }
            }

            state = default;
            return false;
        }

        public void Rescan()
        {
            _rescanRequested = true;
            try { _stream?.Dispose(); } catch { }
        }

        private async Task ReaderLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                HidStream? stream = null;
                try
                {
                    if (!TryOpenDualSense(out var device, out stream) || stream is null)
                    {
                        SetDisconnected(_present ? "DualSense USB detected, HID access unavailable" : "Not detected");
                        await Task.Delay(500, token).ConfigureAwait(false);
                        continue;
                    }

                    _stream = stream;
                    _rescanRequested = false;
                    stream.ReadTimeout = 500;

                    lock (_sync)
                    {
                        _connected = true;
                        _latestState = default;
                        _lastReportUtc = DateTime.UtcNow;
                        _status = device.ProductID == DualSenseEdgeProductId
                            ? "DualSense Edge (USB) • Connected"
                            : "DualSense (USB) • Connected";
                    }

                    var buffer = new byte[Math.Max(64, device.GetMaxInputReportLength())];
                    while (!token.IsCancellationRequested && !_rescanRequested)
                    {
                        int count;
                        try
                        {
                            count = stream.Read(buffer, 0, buffer.Length);
                        }
                        catch (TimeoutException)
                        {
                            // The device is still physically connected even if a report did not
                            // arrive during this short interval.
                            continue;
                        }
                        catch (ObjectDisposedException) when (_rescanRequested)
                        {
                            break;
                        }

                        if (count < 10) continue;

                        // HidSharp normally includes the USB report id (0x01) at byte 0.
                        // Some HID paths can expose the payload without it, so support both layouts.
                        var payloadOffset = buffer[0] == 0x01 ? 1 : 0;
                        if (count < payloadOffset + 10) continue;

                        var state = new State
                        {
                            dwPacketNumber = ++_packetNumber,
                            Gamepad = ParseUsbReport(buffer, payloadOffset)
                        };

                        lock (_sync)
                        {
                            _latestState = state;
                            _lastReportUtc = DateTime.UtcNow;
                            _connected = true;
                            _status = device.ProductID == DualSenseEdgeProductId
                                ? "DualSense Edge (USB) • Connected"
                                : "DualSense (USB) • Connected";
                        }
                    }
                }
                catch (OperationCanceledException) { }
                catch (Exception ex)
                {
                    SetDisconnected(_present ? "DualSense USB detected: " + ex.Message : "Not detected");
                }
                finally
                {
                    try { stream?.Dispose(); } catch { }
                    if (ReferenceEquals(_stream, stream)) _stream = null;
                    if (!_rescanRequested) SetDisconnected(_present ? "DualSense USB disconnected" : "Not detected");
                }

                if (!token.IsCancellationRequested)
                {
                    try { await Task.Delay(150, token).ConfigureAwait(false); }
                    catch (OperationCanceledException) { }
                }
            }
        }

        private bool TryOpenDualSense(out HidDevice device, out HidStream? stream)
        {
            device = null!;
            stream = null;

            HidDevice[] candidates;
            try
            {
                candidates = DeviceList.Local.GetHidDevices(SonyVendorId)
                    .Where(x => x.ProductID == DualSenseProductId || x.ProductID == DualSenseEdgeProductId)
                    .OrderByDescending(x => SafeInputReportLength(x))
                    .ToArray();
            }
            catch
            {
                _present = false;
                return false;
            }

            _present = candidates.Length > 0;
            if (!_present) return false;

            foreach (var candidate in candidates)
            {
                try
                {
                    // The normal DualSense USB gamepad interface exposes a large input report.
                    // Skip tiny auxiliary HID collections such as feature-only interfaces.
                    if (SafeInputReportLength(candidate) < 48) continue;
                    if (!candidate.TryOpen(out var opened) || opened is null) continue;
                    device = candidate;
                    stream = opened;
                    return true;
                }
                catch { }
            }

            return false;
        }

        private static int SafeInputReportLength(HidDevice device)
        {
            try { return device.GetMaxInputReportLength(); }
            catch { return 0; }
        }

        private static Gamepad ParseUsbReport(byte[] data, int o)
        {
            // Payload layout after optional report ID:
            // LX, LY, RX, RY, L2, R2, sequence, buttons0, buttons1, buttons2...
            var buttons0 = data[o + 7];
            var buttons1 = data[o + 8];
            var buttons = (Buttons)0;
            var hat = buttons0 & 0x0F;

            if (hat is 0 or 1 or 7) buttons |= Buttons.DPadUp;
            if (hat is 1 or 2 or 3) buttons |= Buttons.DPadRight;
            if (hat is 3 or 4 or 5) buttons |= Buttons.DPadDown;
            if (hat is 5 or 6 or 7) buttons |= Buttons.DPadLeft;

            if ((buttons0 & 0x10) != 0) buttons |= Buttons.X; // Square
            if ((buttons0 & 0x20) != 0) buttons |= Buttons.A; // Cross
            if ((buttons0 & 0x40) != 0) buttons |= Buttons.B; // Circle
            if ((buttons0 & 0x80) != 0) buttons |= Buttons.Y; // Triangle
            if ((buttons1 & 0x01) != 0) buttons |= Buttons.LeftShoulder;
            if ((buttons1 & 0x02) != 0) buttons |= Buttons.RightShoulder;
            if ((buttons1 & 0x10) != 0) buttons |= Buttons.Back; // Create
            if ((buttons1 & 0x20) != 0) buttons |= Buttons.Start; // Options
            if ((buttons1 & 0x40) != 0) buttons |= Buttons.LeftThumb;
            if ((buttons1 & 0x80) != 0) buttons |= Buttons.RightThumb;

            return new Gamepad
            {
                wButtons = buttons,
                bLeftTrigger = data[o + 4],
                bRightTrigger = data[o + 5],
                sThumbLX = ToAxis(data[o + 0], invert: false),
                sThumbLY = ToAxis(data[o + 1], invert: true),
                sThumbRX = ToAxis(data[o + 2], invert: false),
                sThumbRY = ToAxis(data[o + 3], invert: true)
            };
        }

        private static short ToAxis(byte value, bool invert)
        {
            var centered = value - 128;
            if (invert) centered = -centered;
            return (short)Math.Clamp(centered * 256, short.MinValue, short.MaxValue);
        }

        private void SetDisconnected(string status)
        {
            lock (_sync)
            {
                _connected = false;
                _lastReportUtc = default;
                _status = status;
            }
        }

        public void Dispose()
        {
            _cts.Cancel();
            try { _stream?.Dispose(); } catch { }
            try { _readerTask.Wait(1000); } catch { }
            _cts.Dispose();
        }
    }
}

public sealed class VirtualController : IDisposable
{
    private ViGEmClient? _client;
    private IXbox360Controller? _controller;
    public bool Connected => _controller is not null;
    public string Status { get; private set; } = "Disconnected";

    public bool Connect()
    {
        if (Connected) return true;
        try
        {
            _client = new ViGEmClient();
            _controller = _client.CreateXbox360Controller();
            _controller.Connect();
            Status = "Connected";
            return true;
        }
        catch (Exception ex)
        {
            Status = "ViGEm unavailable: " + ex.Message;
            Dispose();
            return false;
        }
    }

    public void Disconnect()
    {
        try { _controller?.Disconnect(); } catch { }
        _controller = null;
        _client?.Dispose();
        _client = null;
        if (!Status.StartsWith("ViGEm", StringComparison.OrdinalIgnoreCase)) Status = "Disconnected";
    }

    public void Submit(XInput.Gamepad s, double ax, double ay, bool autoFire, bool swapTriggers)
    {
        if (_controller is null) return;
        SetAxis(Xbox360Axis.LeftThumbX, s.sThumbLX);
        SetAxis(Xbox360Axis.LeftThumbY, s.sThumbLY);
        var rx = Math.Clamp(s.sThumbRX / 32767.0 + ax, -1, 1);
        var ry = Math.Clamp(s.sThumbRY / 32767.0 + ay, -1, 1);
        SetAxis(Xbox360Axis.RightThumbX, (short)(rx * 32767));
        SetAxis(Xbox360Axis.RightThumbY, (short)(ry * 32767));
        var leftTrigger = swapTriggers ? s.bRightTrigger : s.bLeftTrigger;
        var rightTrigger = swapTriggers ? s.bLeftTrigger : s.bRightTrigger;
        SetSlider(Xbox360Slider.LeftTrigger, leftTrigger);
        SetSlider(Xbox360Slider.RightTrigger, autoFire ? (byte)255 : rightTrigger);
        SetBtn(Xbox360Button.Up, s.wButtons.HasFlag(XInput.Buttons.DPadUp));
        SetBtn(Xbox360Button.Down, s.wButtons.HasFlag(XInput.Buttons.DPadDown));
        SetBtn(Xbox360Button.Left, s.wButtons.HasFlag(XInput.Buttons.DPadLeft));
        SetBtn(Xbox360Button.Right, s.wButtons.HasFlag(XInput.Buttons.DPadRight));
        SetBtn(Xbox360Button.Start, s.wButtons.HasFlag(XInput.Buttons.Start));
        SetBtn(Xbox360Button.Back, s.wButtons.HasFlag(XInput.Buttons.Back));
        SetBtn(Xbox360Button.LeftThumb, s.wButtons.HasFlag(XInput.Buttons.LeftThumb));
        SetBtn(Xbox360Button.RightThumb, s.wButtons.HasFlag(XInput.Buttons.RightThumb));
        SetBtn(Xbox360Button.LeftShoulder, s.wButtons.HasFlag(XInput.Buttons.LeftShoulder));
        SetBtn(Xbox360Button.RightShoulder, s.wButtons.HasFlag(XInput.Buttons.RightShoulder));
        SetBtn(Xbox360Button.A, s.wButtons.HasFlag(XInput.Buttons.A));
        SetBtn(Xbox360Button.B, s.wButtons.HasFlag(XInput.Buttons.B));
        SetBtn(Xbox360Button.X, s.wButtons.HasFlag(XInput.Buttons.X));
        SetBtn(Xbox360Button.Y, s.wButtons.HasFlag(XInput.Buttons.Y));
    }

    public void Replug() { Disconnect(); Thread.Sleep(300); Connect(); }
    private void SetAxis(Xbox360Axis a, short v) => _controller?.SetAxisValue(a, v);
    private void SetSlider(Xbox360Slider s, byte v) => _controller?.SetSliderValue(s, v);
    private void SetBtn(Xbox360Button b, bool v) => _controller?.SetButtonState(b, v);
    public void Dispose() => Disconnect();
}
