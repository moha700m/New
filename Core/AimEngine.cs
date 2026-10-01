using System.Diagnostics;
using System.Drawing;
using MohammedLab.ColorVision.Models;

namespace MohammedLab.ColorVision.Core;

public sealed class AimEngine : IDisposable
{
    private readonly ScreenCapture _capture = new();
    private readonly ColorDetector _detector = new();
    private readonly VirtualController _virtual = new();
    private CancellationTokenSource? _cts;
    private Task? _loop;
    private long _frames, _lastFpsFrames, _lastFpsTicks, _droppedFrames;
    private double _fps, _grabMs;
    private long _lastPreviewTicks;
    private double _smoothTargetX;
    private double _smoothTargetY;
    private bool _hasSmoothTarget;

    public AppConfig Config { get; private set; }
    public bool Running => _loop is { IsCompleted: false };
    public double CaptureFps => _fps;
    public long FrameCount => Interlocked.Read(ref _frames);
    public long DroppedFrames => Interlocked.Read(ref _droppedFrames);
    public double GrabMs => _grabMs;
    public DateTime LastFrameUtc { get; private set; }
    public DetectionResult LastDetection { get; private set; }
    public XInput.State LastControllerState { get; private set; }
    public string VirtualControllerStatus => "Not used • direct physical input";
    public void ReplugController() => XInput.RescanController();

    public event Action? TelemetryUpdated;
    public event Action<string>? Faulted;
    public event Action<Bitmap>? PreviewFrameReady;

    public AimEngine(AppConfig config) => Config = config;
    public void ApplyConfig(AppConfig config) => Config = config;

    public bool Start()
    {
        if (Running) return true;

        // The detector is visual/offline-training only. Physical DualSense/XInput is read
        // directly; do not create a ViGEm Xbox device just to start capture.
        _virtual.Disconnect();

        Interlocked.Exchange(ref _frames, 0);
        Interlocked.Exchange(ref _droppedFrames, 0);
        _fps = 0;
        _grabMs = 0;
        _lastFpsFrames = 0;
        _lastFpsTicks = Stopwatch.GetTimestamp();
        _lastPreviewTicks = 0;
        _hasSmoothTarget = false;
        LastFrameUtc = default;
        _cts = new CancellationTokenSource();
        _loop = Task.Run(() => Loop(_cts.Token));
        return true;
    }

    public async Task StopAsync()
    {
        if (_cts is null) return;
        _cts.Cancel();
        try { if (_loop is not null) await _loop.ConfigureAwait(false); } catch (OperationCanceledException) { }
        _virtual.Disconnect();
        _cts.Dispose();
        _cts = null;
        _loop = null;
        _hasSmoothTarget = false;
    }

    private async Task Loop(CancellationToken token)
    {
        try
        {
            while (!token.IsCancellationRequested)
            {
                var loopStart = Stopwatch.GetTimestamp();
                var cfg = Config;

                var grabStart = Stopwatch.GetTimestamp();
                var bitmap = _capture.CaptureCenter(cfg.ZoneWidth, cfg.ZoneHeight, cfg.ScreenIndex);
                _grabMs = ElapsedMs(grabStart);

                // Player-shape filtering is visual-only. It feeds Preview/HUD telemetry,
                // not target-driven mouse/controller movement or automatic firing.
                LastDetection = _detector.Detect(bitmap, cfg);
                XInput.TryGetState(0, out var state);
                LastControllerState = state;

                Interlocked.Increment(ref _frames);
                LastFrameUtc = DateTime.UtcNow;
                UpdateFps();
                PublishPreviewIfDue(bitmap, cfg, LastDetection);

                if ((FrameCount & 3) == 0) TelemetryUpdated?.Invoke();

                var targetMs = 1000.0 / Math.Clamp(cfg.CaptureFps, 30, 240);
                var elapsed = ElapsedMs(loopStart);
                if (elapsed > targetMs * 1.5) Interlocked.Increment(ref _droppedFrames);
                var remaining = targetMs - elapsed;
                if (remaining > 1) await Task.Delay(TimeSpan.FromMilliseconds(remaining), token).ConfigureAwait(false);
                else await Task.Yield();
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { Faulted?.Invoke(ex.Message); }
    }

    private void PublishPreviewIfDue(Bitmap bitmap, AppConfig cfg, DetectionResult detection)
    {
        if (cfg.NoPreview || PreviewFrameReady is null) return;
        var now = Stopwatch.GetTimestamp();
        if (_lastPreviewTicks != 0 && (now - _lastPreviewTicks) / (double)Stopwatch.Frequency < 1.0 / 30.0) return;
        _lastPreviewTicks = now;

        var clone = (Bitmap)bitmap.Clone();
        try
        {
            using var g = Graphics.FromImage(clone);
            using var centerPen = new Pen(Color.FromArgb(230, 255, 138, 36), 2f);
            using var fovPen = new Pen(Color.FromArgb(120, 255, 138, 36), 1.2f) { DashStyle = System.Drawing.Drawing2D.DashStyle.Dash };
            var marker = GetMarkerColor(cfg.MarkerPreset);
            using var targetPen = new Pen(Color.FromArgb(235, marker.R, marker.G, marker.B), 2f);
            using var targetBrush = new SolidBrush(Color.FromArgb(235, marker.R, marker.G, marker.B));
            var cx = clone.Width / 2;
            var cy = clone.Height / 2;

            if (cfg.ShowFov)
            {
                var radius = Math.Clamp(cfg.FovRadiusPx, 40, Math.Max(40, Math.Min(clone.Width, clone.Height) / 2));
                g.DrawEllipse(fovPen, cx - radius, cy - radius, radius * 2, radius * 2);
            }

            g.DrawLine(centerPen, cx - 8, cy, cx + 8, cy);
            g.DrawLine(centerPen, cx, cy - 8, cx, cy + 8);

            if (detection.Found)
            {
                var smoothing = Math.Clamp(cfg.PreviewSmoothing, 0.0, 0.90);
                if (!_hasSmoothTarget)
                {
                    _smoothTargetX = detection.Target.X;
                    _smoothTargetY = detection.Target.Y;
                    _hasSmoothTarget = true;
                }
                else
                {
                    _smoothTargetX = _smoothTargetX * smoothing + detection.Target.X * (1.0 - smoothing);
                    _smoothTargetY = _smoothTargetY * smoothing + detection.Target.Y * (1.0 - smoothing);
                }

                g.DrawRectangle(targetPen, detection.Bounds);
                g.FillEllipse(targetBrush, (float)_smoothTargetX - 4, (float)_smoothTargetY - 4, 8, 8);
            }
            else
            {
                _hasSmoothTarget = false;
            }
        }
        catch { }

        PreviewFrameReady.Invoke(clone);
    }

    private static Color GetMarkerColor(MarkerPreset preset) => preset switch
    {
        MarkerPreset.Magenta => Color.Magenta,
        MarkerPreset.Cyan => Color.Cyan,
        MarkerPreset.Red => Color.FromArgb(255, 82, 82),
        MarkerPreset.Yellow => Color.FromArgb(255, 214, 10),
        _ => Color.FromArgb(191, 64, 255)
    };

    private void UpdateFps()
    {
        var now = Stopwatch.GetTimestamp();
        var elapsed = (now - _lastFpsTicks) / (double)Stopwatch.Frequency;
        if (elapsed < .75) return;
        var frames = FrameCount;
        _fps = (frames - _lastFpsFrames) / elapsed;
        _lastFpsFrames = frames;
        _lastFpsTicks = now;
    }

    private static double ElapsedMs(long start) => (Stopwatch.GetTimestamp() - start) * 1000.0 / Stopwatch.Frequency;

    public void Dispose()
    {
        try { StopAsync().GetAwaiter().GetResult(); } catch { }
        _virtual.Dispose();
        _capture.Dispose();
    }
}
