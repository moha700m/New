using System.Text.Json.Serialization;
using System.Text.Json;

namespace MohammedLab.ColorVision.Core;

public enum GameMode { Bo7, Bo6, Mw, Mw4, Overwatch }
public enum AimDevice { Mouse, Controller }
public enum PadButton { None, Cross, Circle, Square, Triangle, L1, R1, L2, R2, L3, R3, Create, Options, DpadUp, DpadDown, DpadLeft, DpadRight }

public sealed class AppConfig
{
    public GameMode Game { get; set; } = GameMode.Bo7;
    public GameMode GuideGame { get; set; } = GameMode.Bo7;
    public int GuideStep { get; set; }
    public int ScreenIndex { get; set; }
    public int ZoneWidth { get; set; } = 400;
    public int ZoneHeight { get; set; } = 560;
    public int CaptureFps { get; set; } = 90;
    public bool NoPreview { get; set; } = true;
    public bool ShowHud { get; set; } = true;
    public AimDevice Device { get; set; } = AimDevice.Mouse;
    public float Strength { get; set; } = 2.8f;
    public int AimPointOffsetPx { get; set; } = 31;
    public bool HoldToAim { get; set; } = true;
    public bool AlwaysTrack { get; set; } = true;
    public int AimKey { get; set; } = 0x02;
    public PadButton AimButton { get; set; } = PadButton.L2;
    public PadButton FireButton { get; set; } = PadButton.R2;
    public bool AntiRecoilOn { get; set; }
    public float AntiRecoil { get; set; } = 6.0f;
    public bool AutoFire { get; set; }

    [JsonIgnore] public static int[] ZoneWidths { get; } = [160, 240, 320, 400, 480, 560, 640, 800];
    [JsonIgnore] public static int[] ZoneHeights { get; } = [160, 240, 320, 400, 480, 560, 640, 800];
    [JsonIgnore] public static int[] CaptureFpsOptions { get; } = [30, 60, 90, 120, 144, 165, 240];
}

public sealed class SettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true, PropertyNameCaseInsensitive = true };
    public string Folder { get; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MohammedLab", "ColorVision");
    public string FilePath => Path.Combine(Folder, "settings.json");

    public AppConfig Load()
    {
        try
        {
            if (!File.Exists(FilePath)) return new AppConfig();
            var value = JsonSerializer.Deserialize<AppConfig>(File.ReadAllText(FilePath), JsonOptions) ?? new AppConfig();
            Clamp(value);
            return value;
        }
        catch { return new AppConfig(); }
    }

    public void Save(AppConfig value)
    {
        Clamp(value);
        Directory.CreateDirectory(Folder);
        var tmp = FilePath + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(value, JsonOptions));
        File.Move(tmp, FilePath, true);
    }

    public static void Clamp(AppConfig s)
    {
        s.ZoneWidth = Nearest(s.ZoneWidth, AppConfig.ZoneWidths);
        s.ZoneHeight = Nearest(s.ZoneHeight, AppConfig.ZoneHeights);
        s.CaptureFps = Nearest(s.CaptureFps, AppConfig.CaptureFpsOptions);
        s.ScreenIndex = Math.Max(0, s.ScreenIndex);
        s.Strength = Math.Clamp(s.Strength, 1f, 10f);
        s.AimPointOffsetPx = Math.Clamp(s.AimPointOffsetPx, -100, 100);
        s.AntiRecoil = Math.Clamp(s.AntiRecoil, 0f, 20f);
    }

    private static int Nearest(int value, IReadOnlyList<int> options) => options.OrderBy(x => Math.Abs(x - value)).First();
}
