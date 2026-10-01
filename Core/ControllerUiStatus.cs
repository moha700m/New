using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;

namespace MohammedLab.ColorVision.Core;

internal static class ControllerUiStatus
{
    private static readonly object Sync = new();
    private static long _lastPostTicks;
    private static string _lastSignature = string.Empty;

    public static void Post(bool connected)
    {
        var app = Application.Current;
        var window = app?.MainWindow;
        if (window is null) return;

        var source = XInput.ControllerSource;
        var name = XInput.ControllerName;
        var dualSensePresent = XInput.DualSenseUsbPresent;
        var dualSenseStatus = XInput.DualSenseStatus;
        var signature = $"{connected}|{source}|{name}|{dualSensePresent}|{dualSenseStatus}";
        var now = Environment.TickCount64;

        lock (Sync)
        {
            // MainWindow's controller poll runs every 100 ms. Post after that poll so the
            // source-specific label wins over the generic Controller Connected label.
            if (signature == _lastSignature && now - _lastPostTicks < 80) return;
            _lastSignature = signature;
            _lastPostTicks = now;
        }

        window.Dispatcher.BeginInvoke(() =>
        {
            var header = window.FindName("HeaderControllerText") as TextBlock;
            var connection = window.FindName("TxtControllerConnection") as TextBlock;
            var sidebar = window.FindName("StatusDevice") as TextBlock;
            var check = window.FindName("TxtCheckPad") as TextBlock;

            string headerText;
            string connectionText;
            string detailText;

            if (source == PhysicalControllerSource.DualSenseUsb && connected)
            {
                headerText = "DualSense USB • Connected";
                connectionText = "DUALSENSE (USB) CONNECTED";
                detailText = dualSenseStatus;
            }
            else if (source == PhysicalControllerSource.DualSenseUsb && dualSensePresent)
            {
                headerText = "DualSense USB • Detected";
                connectionText = "DUALSENSE USB DETECTED • HID NOT READY";
                detailText = dualSenseStatus;
            }
            else if (source == PhysicalControllerSource.XInput && connected)
            {
                headerText = "Xbox / XInput • Connected";
                connectionText = "XBOX / XINPUT CONNECTED";
                detailText = "Physical XInput controller";
            }
            else
            {
                headerText = "Controller • Not connected";
                connectionText = "NOT CONNECTED";
                detailText = "No physical controller detected";
            }

            if (header is not null) header.Text = headerText;
            if (connection is not null) connection.Text = connectionText;
            if (sidebar is not null) sidebar.Text = connected ? $"Device: {name}" : "Device: No controller";
            if (check is not null) check.Text = detailText;
        }, DispatcherPriority.Background);
    }
}
