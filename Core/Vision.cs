using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using Forms = System.Windows.Forms;
using MohammedLab.ColorVision.Models;
using OpenCvSharp;
using OpenCvSharp.Extensions;

namespace MohammedLab.ColorVision.Core;

public sealed class ScreenCapture : IDisposable
{
    private Bitmap? _buffer;

    public static string[] MonitorNames => Forms.Screen.AllScreens
        .Select((s, i) => $"Monitor {i + 1} — {s.Bounds.Width}x{s.Bounds.Height}")
        .ToArray();

    public static Rectangle GetRegionBounds(int width, int height, int screenIndex = 0)
    {
        var screens = Forms.Screen.AllScreens;
        if (screens.Length == 0) throw new InvalidOperationException("No display was detected.");
        var screen = screens[Math.Clamp(screenIndex, 0, screens.Length - 1)];
        var bounds = screen.Bounds;
        width = Math.Clamp(width, 64, bounds.Width);
        height = Math.Clamp(height, 64, bounds.Height);
        return new Rectangle(
            bounds.Left + (bounds.Width - width) / 2,
            bounds.Top + (bounds.Height - height) / 2,
            width,
            height);
    }

    public Bitmap CaptureCenter(int width, int height, int screenIndex = 0)
    {
        var region = GetRegionBounds(width, height, screenIndex);
        if (_buffer is null || _buffer.Width != region.Width || _buffer.Height != region.Height)
        {
            _buffer?.Dispose();
            _buffer = new Bitmap(region.Width, region.Height, PixelFormat.Format24bppRgb);
        }

        using var g = Graphics.FromImage(_buffer);
        g.CopyFromScreen(region.X, region.Y, 0, 0, new System.Drawing.Size(region.Width, region.Height), CopyPixelOperation.SourceCopy);
        return _buffer;
    }

    public DisposeResult TryProbe(int screenIndex = 0)
    {
        try
        {
            CaptureCenter(64, 64, screenIndex);
            return new DisposeResult(true, "Ready");
        }
        catch (Exception ex) { return new DisposeResult(false, ex.Message); }
    }

    public void Dispose() => _buffer?.Dispose();
}

public readonly record struct DisposeResult(bool Ready, string Message);

/// <summary>
/// Visual-only purple player-shape detector for preview/HUD feedback.
/// It deliberately requires player-like geometry and short temporal stability instead of
/// treating every purple pixel/contour as a target.
/// </summary>
public sealed class ColorDetector
{
    private static readonly Scalar Lower = new(140, 90, 110);
    private static readonly Scalar Upper = new(158, 255, 255);

    private OpenCvSharp.Rect? _lastCandidate;
    private int _stableFrames;
    private int _missedFrames;

    public DetectionResult Detect(Bitmap bitmap, AppConfig cfg)
    {
        var sw = Stopwatch.StartNew();
        using var mat = BitmapConverter.ToMat(bitmap);
        using var hsv = new Mat();
        Cv2.CvtColor(mat, hsv, ColorConversionCodes.BGR2HSV);

        // Raw purple mask. Keep this untouched so density/band checks use real pixels,
        // not morphology-expanded pixels.
        using var rawMask = new Mat();
        Cv2.InRange(hsv, Lower, Upper, rawMask);

        // Join small gaps in a purple player outline, then remove isolated specks.
        using var merged = new Mat();
        using var cleaned = new Mat();
        using var closeKernel = Cv2.GetStructuringElement(MorphShapes.Rect, new OpenCvSharp.Size(5, 9));
        using var openKernel = Cv2.GetStructuringElement(MorphShapes.Rect, new OpenCvSharp.Size(3, 3));
        Cv2.MorphologyEx(rawMask, merged, MorphTypes.Close, closeKernel);
        Cv2.MorphologyEx(merged, cleaned, MorphTypes.Open, openKernel);
        Cv2.FindContours(cleaned, out var contours, out _, RetrievalModes.External, ContourApproximationModes.ApproxSimple);

        var frameArea = bitmap.Width * bitmap.Height;
        var minContourArea = Math.Max(18.0, frameArea * 0.00015);
        var maxContourArea = frameArea * 0.18;
        var minHeight = Math.Max(14, (int)Math.Round(bitmap.Height * 0.035));
        var minWidth = Math.Max(4, (int)Math.Round(bitmap.Width * 0.008));
        var borderMargin = 2;
        var cx = bitmap.Width / 2.0;
        var cy = bitmap.Height / 2.0;
        var maxCenterDistance = Math.Sqrt(cx * cx + cy * cy);

        OpenCvSharp.Rect? bestRect = null;
        double bestScore = double.MinValue;
        var candidateCount = 0;

        foreach (var contour in contours)
        {
            var contourArea = Cv2.ContourArea(contour);
            if (contourArea < minContourArea || contourArea > maxContourArea) continue;

            var r = Cv2.BoundingRect(contour);
            if (r.Width < minWidth || r.Height < minHeight) continue;
            if (r.Width > bitmap.Width * 0.35 || r.Height > bitmap.Height * 0.82) continue;

            // A player silhouette/outline is normally taller than it is wide. Keep a little
            // tolerance for crouched/angled poses, but reject long UI bars and flat effects.
            var aspect = r.Height / (double)Math.Max(1, r.Width);
            if (aspect < 0.80 || aspect > 5.5) continue;

            // Purple UI borders and screen-edge effects are common false positives.
            if (r.X <= borderMargin || r.Y <= borderMargin ||
                r.Right >= bitmap.Width - borderMargin || r.Bottom >= bitmap.Height - borderMargin)
                continue;

            using var rawRoi = new Mat(rawMask, r);
            var purplePixels = Cv2.CountNonZero(rawRoi);
            var boxArea = Math.Max(1, r.Width * r.Height);
            var density = purplePixels / (double)boxArea;

            // Thin player outlines can have low fill density; solid UI blocks tend to be high.
            if (purplePixels < 14 || density < 0.018 || density > 0.62) continue;

            // Require purple evidence across at least two vertical body zones. This rejects
            // small labels/icons that happen to have a player-like bounding box.
            var occupiedBands = CountOccupiedVerticalBands(rawMask, r);
            if (occupiedBands < 2) continue;

            candidateCount++;

            var rcx = r.X + r.Width / 2.0;
            var rcy = r.Y + r.Height / 2.0;
            var dx = rcx - cx;
            var dy = rcy - cy;
            var centerScore = 1.0 - Math.Clamp(Math.Sqrt(dx * dx + dy * dy) / Math.Max(1.0, maxCenterDistance), 0, 1);
            var heightScore = Math.Clamp(r.Height / (bitmap.Height * 0.36), 0, 1);
            var aspectScore = 1.0 - Math.Clamp(Math.Abs(aspect - 2.0) / 2.5, 0, 1);
            var densityScore = 1.0 - Math.Clamp(Math.Abs(density - 0.16) / 0.30, 0, 1);
            var bandScore = occupiedBands / 3.0;

            // Geometry is weighted above center proximity so a player-shaped region beats
            // a random purple object merely because it is closer to the crosshair.
            var score =
                centerScore * 0.20 +
                heightScore * 0.25 +
                aspectScore * 0.22 +
                densityScore * 0.18 +
                bandScore * 0.15;

            if (score <= bestScore) continue;
            bestScore = score;
            bestRect = r;
        }

        if (bestRect is null)
        {
            _missedFrames++;
            if (_missedFrames > 1)
            {
                _lastCandidate = null;
                _stableFrames = 0;
            }

            sw.Stop();
            return DetectionResult.None(sw.Elapsed.TotalMilliseconds) with { CandidateCount = candidateCount };
        }

        _missedFrames = 0;
        var selected = bestRect.Value;
        if (_lastCandidate is { } previous && IsSameTrack(previous, selected))
            _stableFrames = Math.Min(_stableFrames + 1, 8);
        else
            _stableFrames = 1;
        _lastCandidate = selected;

        // A single-frame flash is not considered a confirmed player.
        if (_stableFrames < 2)
        {
            sw.Stop();
            return DetectionResult.None(sw.Elapsed.TotalMilliseconds) with { CandidateCount = candidateCount };
        }

        var tx = selected.X + selected.Width / 2;
        var ty = Math.Clamp(selected.Y + (int)Math.Round(selected.Height * 0.38), 0, bitmap.Height - 1);
        var stability = Math.Clamp(_stableFrames / 4.0, 0, 1);
        var confidence = Math.Clamp(bestScore * (0.70 + stability * 0.30), 0, 1);

        sw.Stop();
        return new DetectionResult(
            true,
            new System.Drawing.Point(tx, ty),
            new Rectangle(selected.X, selected.Y, selected.Width, selected.Height),
            confidence,
            candidateCount,
            sw.Elapsed.TotalMilliseconds);
    }

    private static int CountOccupiedVerticalBands(Mat rawMask, OpenCvSharp.Rect r)
    {
        var occupied = 0;
        for (var band = 0; band < 3; band++)
        {
            var y0 = r.Y + r.Height * band / 3;
            var y1 = r.Y + r.Height * (band + 1) / 3;
            var height = Math.Max(1, y1 - y0);
            var bandRect = new OpenCvSharp.Rect(r.X, y0, r.Width, height);
            using var roi = new Mat(rawMask, bandRect);
            var pixels = Cv2.CountNonZero(roi);
            var minimum = Math.Max(2, (int)Math.Round(r.Width * height * 0.006));
            if (pixels >= minimum) occupied++;
        }
        return occupied;
    }

    private static bool IsSameTrack(OpenCvSharp.Rect a, OpenCvSharp.Rect b)
    {
        var intersectionX1 = Math.Max(a.X, b.X);
        var intersectionY1 = Math.Max(a.Y, b.Y);
        var intersectionX2 = Math.Min(a.Right, b.Right);
        var intersectionY2 = Math.Min(a.Bottom, b.Bottom);
        var iw = Math.Max(0, intersectionX2 - intersectionX1);
        var ih = Math.Max(0, intersectionY2 - intersectionY1);
        var intersection = iw * ih;
        var union = Math.Max(1, a.Width * a.Height + b.Width * b.Height - intersection);
        var iou = intersection / (double)union;
        if (iou >= 0.10) return true;

        var acx = a.X + a.Width / 2.0;
        var acy = a.Y + a.Height / 2.0;
        var bcx = b.X + b.Width / 2.0;
        var bcy = b.Y + b.Height / 2.0;
        var dx = acx - bcx;
        var dy = acy - bcy;
        var distance = Math.Sqrt(dx * dx + dy * dy);
        var tolerance = Math.Max(18.0, Math.Max(Math.Max(a.Width, a.Height), Math.Max(b.Width, b.Height)) * 0.55);
        return distance <= tolerance;
    }

    public static string OpenCvVersion()
    {
        try { return Cv2.GetVersionString(); }
        catch (Exception ex) { return "Unavailable: " + ex.Message; }
    }
}
