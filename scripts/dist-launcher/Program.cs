using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace PiAlphaDesk
{
    /// <summary>
    /// 静默启动入口：Windows 隐藏执行 start.cmd，其他系统执行 start.sh。
    /// .exe 仅 Windows 可用；Unix 请用同目录 pi-alpha-desk / start.sh。
    /// </summary>
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            try
            {
                string appDir = GetAppDirectory();
                bool isWindows = IsWindows();
                string scriptName = isWindows ? "start.cmd" : "start.sh";
                string scriptPath = Path.Combine(appDir, scriptName);

                if (!File.Exists(scriptPath))
                {
                    Fail("找不到启动脚本：\n" + scriptPath +
                         "\n\n请把本程序放在与 start.cmd / start.sh 同一目录。");
                    return;
                }

                var psi = new ProcessStartInfo();
                psi.WorkingDirectory = appDir;

                if (isWindows)
                {
                    // 隐藏控制台执行 start.cmd（服务在后台，用户看不到窗口）
                    string cmd = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.System),
                        "cmd.exe");
                    if (!File.Exists(cmd)) cmd = "cmd.exe";
                    psi.FileName = cmd;
                    psi.Arguments = "/c \"" + scriptPath + "\"";
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;
                    psi.WindowStyle = ProcessWindowStyle.Hidden;
                }
                else
                {
                    psi.FileName = "/bin/bash";
                    psi.Arguments = "\"" + scriptPath + "\"";
                    psi.UseShellExecute = false;
                }

                Process.Start(psi);
            }
            catch (Exception ex)
            {
                Fail(ex.Message);
            }
        }

        private static string GetAppDirectory()
        {
            string exe = Application.ExecutablePath;
            return Path.GetDirectoryName(Path.GetFullPath(exe));
        }

        private static bool IsWindows()
        {
            PlatformID p = Environment.OSVersion.Platform;
            return p == PlatformID.Win32NT
                || p == PlatformID.Win32Windows
                || p == PlatformID.Win32S
                || p == PlatformID.WinCE;
        }

        private static void Fail(string message)
        {
            MessageBox.Show(
                message,
                "pi-alpha-desk",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }
}
