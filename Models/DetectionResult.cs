using System.Drawing;

namespace MohammedLab.ColorVision.Models;

public readonly record struct DetectionResult(
    bool Found,
    Point Target,
    Rectangle Bounds,
    double Confidence,
    int CandidateCount,
    double ProcessingMs)
{
    public static DetectionResult None(double processingMs = 0) =>
        new(false, Point.Empty, Rectangle.Empty, 0, 0, processingMs);
}
