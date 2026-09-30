using System.Drawing;
using System.Drawing.Imaging;
using Forms = System.Windows.Forms;
using System.Diagnostics;
using MohammedLab.ColorVision.Models;
using OpenCvSharp;
using OpenCvSharp.Extensions;

namespace MohammedLab.ColorVision.Core;

public sealed class ScreenCapture : IDisposable
{
    private Bitmap? _buffer;
    public static string[] MonitorNames => Forms.Screen.AllScreens.Select((s, i) => $"{i + 1} - {s.DeviceName} ({s.Bounds.Width}x{s.Bounds.Height})").ToArray();

    public Bitmap CaptureCenter(int width, int height, int screenIndex = 0)
    {
        var screens = Forms.Screen.AllScreens;
        if (screens.Length == 0) throw new InvalidOperationException("No display was detected.");
        var screen = screens[Math.Clamp(screenIndex, 0, screens.Length - 1)];
        var bounds = screen.Bounds;
        width = Math.Clamp(width, 64, bounds.Width);
        height = Math.Clamp(height, 64, bounds.Height);
        if (_buffer is null || _buffer.Width != width || _buffer.Height != height)
        {
            _buffer?.Dispose();
            _buffer = new Bitmap(width, height, PixelFormat.Format24bppRgb);
        }
        var x = bounds.Left + (bounds.Width - width) / 2;
        var y = bounds.Top + (bounds.Height - height) / 2;
        using var g = Graphics.FromImage(_buffer);
        g.CopyFromScreen(x, y, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
        return _buffer;
    }

    public void Dispose() => _buffer?.Dispose();
}

public sealed class ColorDetector
{
    private static readonly Scalar Lower = new(140, 90, 110);
    private static readonly Scalar Upper = new(158, 255, 255);

    public DetectionResult Detect(Bitmap bitmap, AppConfig cfg)
    {
        var sw = Stopwatch.StartNew();
        using var mat = BitmapConverter.ToMat(bitmap);
        using var hsv = new Mat();
        Cv2.CvtColor(mat, hsv, ColorConversionCodes.BGR2HSV);
        using var mask = new Mat();
        Cv2.InRange(hsv, Lower, Upper, mask);
        using var kernel = Cv2.GetStructuringElement(MorphShapes.Rect, new OpenCvSharp.Size(3, 3));
        Cv2.MorphologyEx(mask, mask, MorphTypes.Open, kernel);
        Cv2.FindContours(mask, out var contours, out _, RetrievalModes.External, ContourApproximationModes.ApproxSimple);

        var cx = bitmap.Width / 2.0;
        var cy = bitmap.Height / 2.0;
        var bestDist = double.MaxValue;
        var count = 0;
        var best = DetectionResult.None();
        foreach (var contour in contours)
        {
            var area = Cv2.ContourArea(contour);
            if (area < 4 || area > 30000) continue;
            var r = Cv2.BoundingRect(contour);
            if (r.Width < 2 || r.Height < 2) continue;
            count++;
            var tx = r.X + r.Width / 2;
            var ty = Math.Clamp(r.Y + cfg.AimPointOffsetPx, 0, bitmap.Height - 1);
            var dx = tx - cx;
            var dy = ty - cy;
            var dist = dx * dx + dy * dy;
            if (dist >= bestDist) continue;
            bestDist = dist;
            var confidence = Math.Clamp(1.0 - Math.Sqrt(dist) / Math.Sqrt(cx * cx + cy * cy), 0, 1);
            best = new DetectionResult(true, new System.Drawing.Point(tx, ty), new Rectangle(r.X, r.Y, r.Width, r.Height), confidence, count, 0);
        }
        sw.Stop();
        return best with { CandidateCount = count, ProcessingMs = sw.Elapsed.TotalMilliseconds };
    }
}
