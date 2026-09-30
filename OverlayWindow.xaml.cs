using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using MohammedLab.ColorVision.Models;

namespace MohammedLab.ColorVision;

public partial class OverlayWindow : Window
{
    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TRANSPARENT = 0x20;
    private const int WS_EX_TOOLWINDOW = 0x80;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const uint WDA_EXCLUDEFROMCAPTURE = 0x11;

    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll")] private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    [DllImport("user32.dll")] private static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);

    public OverlayWindow()
    {
        InitializeComponent();
        SourceInitialized += (_, _) => ConfigureNativeWindow();
    }

    private void ConfigureNativeWindow()
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        var ex = GetWindowLong(hwnd, GWL_EXSTYLE);
        SetWindowLong(hwnd, GWL_EXSTYLE, ex | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);
        try { SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE); } catch { }
    }

    public void UpdateRegion(System.Drawing.Rectangle bounds)
    {
        var dpi = VisualTreeHelper.GetDpi(this);
        Left = bounds.X / dpi.DpiScaleX;
        Top = bounds.Y / dpi.DpiScaleY;
        Width = bounds.Width / dpi.DpiScaleX;
        Height = bounds.Height / dpi.DpiScaleY;
        UpdateCenter();
    }

    public void UpdateTarget(DetectionResult detection, int sourceWidth, int sourceHeight)
    {
        UpdateCenter();
        if (!detection.Found || sourceWidth <= 0 || sourceHeight <= 0)
        {
            TargetBox.Visibility = Visibility.Collapsed;
            TargetDot.Visibility = Visibility.Collapsed;
            return;
        }

        var sx = ActualWidth / sourceWidth;
        var sy = ActualHeight / sourceHeight;
        var r = detection.Bounds;
        Canvas.SetLeft(TargetBox, r.X * sx);
        Canvas.SetTop(TargetBox, r.Y * sy);
        TargetBox.Width = Math.Max(2, r.Width * sx);
        TargetBox.Height = Math.Max(2, r.Height * sy);
        Canvas.SetLeft(TargetDot, detection.Target.X * sx - 4);
        Canvas.SetTop(TargetDot, detection.Target.Y * sy - 4);
        TargetBox.Visibility = Visibility.Visible;
        TargetDot.Visibility = Visibility.Visible;
    }

    private void UpdateCenter()
    {
        var cx = ActualWidth / 2;
        var cy = ActualHeight / 2;
        Canvas.SetLeft(CenterH, cx);
        Canvas.SetTop(CenterH, cy);
        Canvas.SetLeft(CenterV, cx);
        Canvas.SetTop(CenterV, cy);
    }
}
