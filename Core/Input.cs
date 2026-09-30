using System.Runtime.InteropServices;
using Nefarius.ViGEm.Client;
using Nefarius.ViGEm.Client.Targets;
using Nefarius.ViGEm.Client.Targets.Xbox360;

namespace MohammedLab.ColorVision.Core;

public static class MouseInjector
{
    private const uint MOVE = 0x0001, LEFTDOWN = 0x0002, LEFTUP = 0x0004;
    [DllImport("user32.dll")] private static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int vKey);
    public static bool IsDown(int virtualKey) => (GetAsyncKeyState(virtualKey) & 0x8000) != 0;
    public static void Move(int dx, int dy) { if (dx != 0 || dy != 0) mouse_event(MOVE, dx, dy, 0, UIntPtr.Zero); }
    public static void LeftDown() => mouse_event(LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
    public static void LeftUp() => mouse_event(LEFTUP, 0, 0, 0, UIntPtr.Zero);
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

    public static bool TryGetState(int index, out State state)
    {
        try { return GetStateNative((uint)Math.Clamp(index, 0, 3), out state) == 0; }
        catch (DllNotFoundException) { state = default; return false; }
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
        try { _client = new ViGEmClient(); _controller = _client.CreateXbox360Controller(); _controller.Connect(); Status = "Connected"; return true; }
        catch (Exception ex) { Status = "ViGEm unavailable: " + ex.Message; Dispose(); return false; }
    }
    public void Disconnect() { try { _controller?.Disconnect(); } catch { } _controller = null; _client?.Dispose(); _client = null; if (!Status.StartsWith("ViGEm")) Status = "Disconnected"; }
    public void Submit(XInput.Gamepad s, double ax, double ay, bool autoFire)
    {
        if (_controller is null) return;
        SetAxis(Xbox360Axis.LeftThumbX, s.sThumbLX); SetAxis(Xbox360Axis.LeftThumbY, s.sThumbLY);
        var rx = Math.Clamp(s.sThumbRX / 32767.0 + ax, -1, 1); var ry = Math.Clamp(s.sThumbRY / 32767.0 + ay, -1, 1);
        SetAxis(Xbox360Axis.RightThumbX, (short)(rx * 32767)); SetAxis(Xbox360Axis.RightThumbY, (short)(ry * 32767));
        SetSlider(Xbox360Slider.LeftTrigger, s.bLeftTrigger); SetSlider(Xbox360Slider.RightTrigger, autoFire ? (byte)255 : s.bRightTrigger);
        SetBtn(Xbox360Button.Up, s.wButtons.HasFlag(XInput.Buttons.DPadUp)); SetBtn(Xbox360Button.Down, s.wButtons.HasFlag(XInput.Buttons.DPadDown));
        SetBtn(Xbox360Button.Left, s.wButtons.HasFlag(XInput.Buttons.DPadLeft)); SetBtn(Xbox360Button.Right, s.wButtons.HasFlag(XInput.Buttons.DPadRight));
        SetBtn(Xbox360Button.Start, s.wButtons.HasFlag(XInput.Buttons.Start)); SetBtn(Xbox360Button.Back, s.wButtons.HasFlag(XInput.Buttons.Back));
        SetBtn(Xbox360Button.LeftThumb, s.wButtons.HasFlag(XInput.Buttons.LeftThumb)); SetBtn(Xbox360Button.RightThumb, s.wButtons.HasFlag(XInput.Buttons.RightThumb));
        SetBtn(Xbox360Button.LeftShoulder, s.wButtons.HasFlag(XInput.Buttons.LeftShoulder)); SetBtn(Xbox360Button.RightShoulder, s.wButtons.HasFlag(XInput.Buttons.RightShoulder));
        SetBtn(Xbox360Button.A, s.wButtons.HasFlag(XInput.Buttons.A)); SetBtn(Xbox360Button.B, s.wButtons.HasFlag(XInput.Buttons.B));
        SetBtn(Xbox360Button.X, s.wButtons.HasFlag(XInput.Buttons.X)); SetBtn(Xbox360Button.Y, s.wButtons.HasFlag(XInput.Buttons.Y));
    }
    public void Replug() { Disconnect(); Thread.Sleep(300); Connect(); }
    private void SetAxis(Xbox360Axis a, short v) => _controller?.SetAxisValue(a, v);
    private void SetSlider(Xbox360Slider s, byte v) => _controller?.SetSliderValue(s, v);
    private void SetBtn(Xbox360Button b, bool v) => _controller?.SetButtonState(b, v);
    public void Dispose() => Disconnect();
}
