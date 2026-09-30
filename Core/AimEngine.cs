using System.Diagnostics;
using MohammedLab.ColorVision.Models;

namespace MohammedLab.ColorVision.Core;

public sealed class AimEngine : IDisposable
{
    private readonly ScreenCapture _capture = new();
    private readonly ColorDetector _detector = new();
    private readonly VirtualController _virtual = new();
    private CancellationTokenSource? _cts;
    private Task? _loop;
    private long _frames, _lastFpsFrames, _lastFpsTicks;
    private double _fps;
    private bool _mouseAutoFireDown;

    public AppConfig Config { get; private set; }
    public bool Running => _loop is { IsCompleted: false };
    public double CaptureFps => _fps;
    public DetectionResult LastDetection { get; private set; }
    public XInput.State LastControllerState { get; private set; }
    public string VirtualControllerStatus => _virtual.Status;
    public void ReplugController() => _virtual.Replug();
    public event Action? TelemetryUpdated;
    public event Action<string>? Faulted;

    public AimEngine(AppConfig config) => Config = config;
    public void ApplyConfig(AppConfig config) => Config = config;

    public bool Start()
    {
        if (Running) return true;
        if (Config.Device == AimDevice.Controller && !_virtual.Connect())
        {
            Faulted?.Invoke(_virtual.Status);
            return false;
        }
        _cts = new CancellationTokenSource();
        _lastFpsTicks = Stopwatch.GetTimestamp();
        _lastFpsFrames = _frames;
        _loop = Task.Run(() => Loop(_cts.Token));
        return true;
    }

    public async Task StopAsync()
    {
        if (_cts is null) return;
        _cts.Cancel();
        try { if (_loop is not null) await _loop.ConfigureAwait(false); } catch (OperationCanceledException) { }
        if (_mouseAutoFireDown) { MouseInjector.LeftUp(); _mouseAutoFireDown = false; }
        _virtual.Disconnect();
        _cts.Dispose(); _cts = null; _loop = null;
    }

    private async Task Loop(CancellationToken token)
    {
        try
        {
            while (!token.IsCancellationRequested)
            {
                var start = Stopwatch.GetTimestamp();
                var cfg = Config;
                var bitmap = _capture.CaptureCenter(cfg.ZoneWidth, cfg.ZoneHeight, cfg.ScreenIndex);
                LastDetection = _detector.Detect(bitmap, cfg);
                XInput.TryGetState(0, out var state);
                LastControllerState = state;
                ApplyAim(cfg, state, LastDetection);
                _frames++;
                UpdateFps();
                if ((_frames & 3) == 0) TelemetryUpdated?.Invoke();
                var targetMs = 1000.0 / Math.Clamp(cfg.CaptureFps, 30, 240);
                var elapsed = (Stopwatch.GetTimestamp() - start) * 1000.0 / Stopwatch.Frequency;
                if (targetMs - elapsed > 1) await Task.Delay(TimeSpan.FromMilliseconds(targetMs - elapsed), token).ConfigureAwait(false);
                else await Task.Yield();
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { Faulted?.Invoke(ex.ToString()); }
    }

    private void ApplyAim(AppConfig cfg, XInput.State state, DetectionResult d)
    {
        var aimHeld = cfg.Device == AimDevice.Mouse ? MouseInjector.IsDown(cfg.AimKey) : IsPressed(cfg.AimButton, state.Gamepad);
        var fireHeld = cfg.Device == AimDevice.Mouse ? MouseInjector.IsDown(0x01) : IsPressed(cfg.FireButton, state.Gamepad);
        var active = cfg.AlwaysTrack || !cfg.HoldToAim || aimHeld;

        if (cfg.Device == AimDevice.Mouse)
        {
            if (active && d.Found)
            {
                var dx = d.Target.X - cfg.ZoneWidth / 2.0;
                var dy = d.Target.Y - cfg.ZoneHeight / 2.0;
                var divisor = Math.Max(1.0, 11.0 - cfg.Strength);
                MouseInjector.Move((int)Math.Round(dx / divisor), (int)Math.Round(dy / divisor));
            }
            if (cfg.AntiRecoilOn && fireHeld) MouseInjector.Move(0, (int)Math.Round(cfg.AntiRecoil));
            if (cfg.AutoFire && active && d.Found)
            {
                if (!_mouseAutoFireDown) { MouseInjector.LeftDown(); _mouseAutoFireDown = true; }
            }
            else if (_mouseAutoFireDown) { MouseInjector.LeftUp(); _mouseAutoFireDown = false; }
            return;
        }

        if (!_virtual.Connected) return;
        var ax = 0.0; var ay = 0.0;
        if (active && d.Found)
        {
            var dx = (d.Target.X - cfg.ZoneWidth / 2.0) / (cfg.ZoneWidth / 2.0);
            var dy = (d.Target.Y - cfg.ZoneHeight / 2.0) / (cfg.ZoneHeight / 2.0);
            var gain = Math.Clamp(cfg.Strength / 10.0, .05, 1.0);
            ax = Math.Clamp(dx * gain, -1, 1);
            ay = Math.Clamp(-dy * gain, -1, 1);
        }
        if (cfg.AntiRecoilOn && fireHeld) ay -= Math.Clamp(cfg.AntiRecoil / 100.0, 0, .5);
        _virtual.Submit(state.Gamepad, ax, ay, cfg.AutoFire && active && d.Found);
    }

    private static bool IsPressed(PadButton b, XInput.Gamepad g) => b switch
    {
        PadButton.Cross => g.wButtons.HasFlag(XInput.Buttons.A), PadButton.Circle => g.wButtons.HasFlag(XInput.Buttons.B),
        PadButton.Square => g.wButtons.HasFlag(XInput.Buttons.X), PadButton.Triangle => g.wButtons.HasFlag(XInput.Buttons.Y),
        PadButton.L1 => g.wButtons.HasFlag(XInput.Buttons.LeftShoulder), PadButton.R1 => g.wButtons.HasFlag(XInput.Buttons.RightShoulder),
        PadButton.L2 => g.bLeftTrigger >= 60, PadButton.R2 => g.bRightTrigger >= 60,
        PadButton.L3 => g.wButtons.HasFlag(XInput.Buttons.LeftThumb), PadButton.R3 => g.wButtons.HasFlag(XInput.Buttons.RightThumb),
        PadButton.Create => g.wButtons.HasFlag(XInput.Buttons.Back), PadButton.Options => g.wButtons.HasFlag(XInput.Buttons.Start),
        PadButton.DpadUp => g.wButtons.HasFlag(XInput.Buttons.DPadUp), PadButton.DpadDown => g.wButtons.HasFlag(XInput.Buttons.DPadDown),
        PadButton.DpadLeft => g.wButtons.HasFlag(XInput.Buttons.DPadLeft), PadButton.DpadRight => g.wButtons.HasFlag(XInput.Buttons.DPadRight), _ => false
    };

    private void UpdateFps()
    {
        var now = Stopwatch.GetTimestamp(); var elapsed = (now - _lastFpsTicks) / (double)Stopwatch.Frequency;
        if (elapsed < .75) return;
        _fps = (_frames - _lastFpsFrames) / elapsed; _lastFpsFrames = _frames; _lastFpsTicks = now;
    }

    public void Dispose() { try { StopAsync().GetAwaiter().GetResult(); } catch { } _virtual.Dispose(); _capture.Dispose(); }
}
