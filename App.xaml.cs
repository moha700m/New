using System.Windows;
using System.Windows.Threading;

namespace MohammedLab.ColorVision;

public partial class App : System.Windows.Application
{
    public App()
    {
        DispatcherUnhandledException += OnDispatcherUnhandledException;
    }

    private void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        MessageBox.Show($"Mohammed Lab PC recovered from an unexpected UI error.\n\n{e.Exception.Message}", "Mohammed Lab PC", MessageBoxButton.OK, MessageBoxImage.Warning);
        e.Handled = true;
    }
}
