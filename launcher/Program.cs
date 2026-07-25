using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32;

namespace MaterialMakerLauncher;

internal static class Program
{
    private const string AppTitle = "Forge Material Studio";
    private const string MutexName = @"Local\ForgeMaterialStudioLauncher";
    private const int DefaultAppPort = 54581;
    private const string AppPortFileName = "app-port.txt";
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;

    private static readonly object CleanupLock = new();
    private static readonly object LogLock = new();
    private static IntPtr serverJob;
    private static IntPtr browserJob;
    private static Process? serverProcess;
    private static Process? browserProcess;
    private static string? logPath;
    private static bool cleanupStarted;

    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        using var mutex = new Mutex(true, MutexName, out var ownsMutex);
        if (!ownsMutex)
        {
            MessageBox.Show(
                "Material Maker is already starting or running.\n\nWait for its startup window, or close its browser window before launching it again.",
                AppTitle,
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return;
        }

        AppDomain.CurrentDomain.ProcessExit += (_, _) => Cleanup();

        using var startupForm = new StartupForm();
        startupForm.FormClosed += (_, _) => Cleanup();
        startupForm.Shown += async (_, _) =>
        {
            try
            {
                await RunAsync(args, startupForm);
            }
            catch (Exception exception)
            {
                Log("Launcher error: " + exception);
                Cleanup();
                startupForm.Hide();
                var logMessage = logPath is null
                    ? string.Empty
                    : "\n\nDetails were saved to:\n" + logPath;

                MessageBox.Show(
                    "Material Maker could not start.\n\n" + exception.Message + logMessage,
                    AppTitle,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
            finally
            {
                Cleanup();
                startupForm.Close();
            }
        };

        Application.Run(startupForm);
    }

    private static async Task RunAsync(string[] args, StartupForm startupForm)
    {
        var projectRoot = FindProjectRoot(AppContext.BaseDirectory);
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var stateDirectory = Path.Combine(
            localAppData,
            "Forge Material Studio",
            "Launcher");
        Directory.CreateDirectory(stateDirectory);
        logPath = Path.Combine(stateDirectory, "launcher.log");
        File.WriteAllText(
            logPath,
            string.Format(
                "{0:O} Starting {1}{2}",
                DateTimeOffset.Now,
                AppTitle,
                Environment.NewLine));

        Log("Project root: " + projectRoot);

        startupForm.SetStatus("Checking project dependencies…");
        var npmPath = FindNpm();
        serverJob = CreateKillOnCloseJob();

        await EnsureDependenciesAsync(projectRoot, stateDirectory, npmPath);

        startupForm.SetStatus("Starting the local Material Maker service…");
        var port = ResolveAppPort(stateDirectory);
        EnsurePortAvailable(port);
        var url = "http://localhost:" + port;
        StartServer(projectRoot, npmPath, port);
        await WaitForServerAsync(url, TimeSpan.FromSeconds(90));
        Log("Development server is ready at " + url);

        if (args.Any(argument => argument.Equals("--smoke-test", StringComparison.OrdinalIgnoreCase)))
        {
            Log("Smoke test completed successfully.");
            return;
        }

        startupForm.SetStatus("Opening Material Maker…");
        var browserPath = FindBrowser();
        browserJob = CreateKillOnCloseJob();
        browserProcess = StartBrowser(browserPath, url, stateDirectory);
        AssignProcessToJobOrThrow(browserJob, browserProcess, "browser");
        Log("Browser started: " + browserPath);
        startupForm.Hide();

        await WaitForBrowserWindowToCloseAsync(browserJob);
        Log("Browser window closed; shutting down local services.");
    }

    private static string FindProjectRoot(string startDirectory)
    {
        var directory = new DirectoryInfo(startDirectory);

        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "package.json")) &&
                Directory.Exists(Path.Combine(directory.FullName, "app")))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException(
            "Keep “Material Maker.exe” inside the Material Maker project folder.");
    }

    private static string FindNpm()
    {
        var pathValue = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        var pathEntries = pathValue.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries);

        foreach (var entry in pathEntries)
        {
            var candidate = Path.Combine(entry.Trim().Trim('"'), "npm.cmd");
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        var standardCandidates = new[]
        {
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "nodejs",
                "npm.cmd"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs",
                "nodejs",
                "npm.cmd")
        };

        var npm = standardCandidates.FirstOrDefault(File.Exists);
        return npm ?? throw new FileNotFoundException(
            "Node.js was not found. Install Node.js 22 or newer, then launch Material Maker again.");
    }

    private static async Task EnsureDependenciesAsync(
        string projectRoot,
        string stateDirectory,
        string npmPath)
    {
        var lockfilePath = Path.Combine(projectRoot, "package-lock.json");
        var markerPath = Path.Combine(stateDirectory, "package-lock.sha256");
        var nodeModulesPath = Path.Combine(projectRoot, "node_modules");
        var lockfileHash = File.Exists(lockfilePath) ? ComputeSha256(lockfilePath) : "no-lockfile";
        var installedHash = File.Exists(markerPath) ? File.ReadAllText(markerPath).Trim() : string.Empty;

        if (Directory.Exists(nodeModulesPath) && string.IsNullOrEmpty(installedHash))
        {
            File.WriteAllText(markerPath, lockfileHash);
            Log("Existing dependencies were adopted.");
            return;
        }

        if (Directory.Exists(nodeModulesPath) && installedHash == lockfileHash)
        {
            Log("Dependencies are current.");
            return;
        }

        Log("Installing or refreshing project dependencies.");
        var exitCode = await RunNpmCommandAsync(
            projectRoot,
            npmPath,
            "ci --no-audit --no-fund");

        if (exitCode != 0)
        {
            throw new InvalidOperationException(
                "Project dependencies could not be installed. Check the launcher log for details.");
        }

        File.WriteAllText(markerPath, lockfileHash);
        Log("Dependencies are ready.");
    }

    private static string ComputeSha256(string filePath)
    {
        using var stream = File.OpenRead(filePath);
        return Convert.ToHexString(SHA256.HashData(stream));
    }

    private static async Task<int> RunNpmCommandAsync(
        string workingDirectory,
        string npmPath,
        string arguments)
    {
        using var process = CreateLoggedProcess(
            GetCommandProcessor(),
            BuildCommandArguments(npmPath, arguments),
            workingDirectory);

        process.Start();
        AssignProcessToJobOrThrow(serverJob, process, "dependency installer");
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        await process.WaitForExitAsync();
        return process.ExitCode;
    }

    private static void StartServer(string projectRoot, string npmPath, int port)
    {
        var npmArguments = "run dev -- --host 127.0.0.1 --port " + port;
        serverProcess = CreateLoggedProcess(
            GetCommandProcessor(),
            BuildCommandArguments(npmPath, npmArguments),
            projectRoot);

        serverProcess.Start();
        AssignProcessToJobOrThrow(serverJob, serverProcess, "development server");
        serverProcess.BeginOutputReadLine();
        serverProcess.BeginErrorReadLine();
        Log("Development server process started.");
    }

    private static Process CreateLoggedProcess(
        string fileName,
        string arguments,
        string workingDirectory)
    {
        var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                WorkingDirectory = workingDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            }
        };

        process.OutputDataReceived += (_, eventArgs) =>
        {
            if (!string.IsNullOrWhiteSpace(eventArgs.Data))
            {
                Log("[output] " + eventArgs.Data);
            }
        };
        process.ErrorDataReceived += (_, eventArgs) =>
        {
            if (!string.IsNullOrWhiteSpace(eventArgs.Data))
            {
                Log("[error] " + eventArgs.Data);
            }
        };

        return process;
    }

    private static string GetCommandProcessor()
    {
        return Environment.GetEnvironmentVariable("ComSpec") ??
               Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "cmd.exe");
    }

    private static string BuildCommandArguments(string commandPath, string arguments)
    {
        return "/d /s /c \"\"" + commandPath + "\" " + arguments + "\"";
    }

    private static int ResolveAppPort(string stateDirectory)
    {
        var portFilePath = Path.Combine(stateDirectory, AppPortFileName);
        if (File.Exists(portFilePath) &&
            int.TryParse(File.ReadAllText(portFilePath).Trim(), out var savedPort) &&
            savedPort is > 0 and <= ushort.MaxValue)
        {
            Log("Reusing material storage origin on port " + savedPort + ".");
            return savedPort;
        }

        var indexedDbDirectory = Path.Combine(
            stateDirectory,
            "browser-profile",
            "Default",
            "IndexedDB");
        var legacyPort = Directory.Exists(indexedDbDirectory)
            ? Directory
                .EnumerateDirectories(
                    indexedDbDirectory,
                    "http_localhost_*.indexeddb.leveldb",
                    SearchOption.TopDirectoryOnly)
                .Select(path => new DirectoryInfo(path))
                .OrderByDescending(directory => directory.LastWriteTimeUtc)
                .Select(directory => ParseIndexedDbPort(directory.Name))
                .FirstOrDefault(port => port is > 0 and <= ushort.MaxValue)
            : 0;
        var port = legacyPort == 0 ? DefaultAppPort : legacyPort;

        File.WriteAllText(portFilePath, port.ToString());
        Log(
            legacyPort == 0
                ? "Created material storage origin on port " + port + "."
                : "Recovered the most recent material storage origin on port " + port + ".");
        return port;
    }

    private static int ParseIndexedDbPort(string directoryName)
    {
        const string prefix = "http_localhost_";
        const string suffix = ".indexeddb.leveldb";
        if (!directoryName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ||
            !directoryName.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
        {
            return 0;
        }

        var portText = directoryName[prefix.Length..^suffix.Length];
        return int.TryParse(portText, out var port) ? port : 0;
    }

    private static void EnsurePortAvailable(int port)
    {
        using var listener = new TcpListener(IPAddress.Loopback, port);
        try
        {
            listener.Start();
        }
        catch (SocketException exception)
        {
            throw new InvalidOperationException(
                "Material Maker's local address is already in use. Close any existing Material Maker window and try again.",
                exception);
        }
    }

    private static async Task WaitForServerAsync(string url, TimeSpan timeout)
    {
        using var client = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(2)
        };

        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (serverProcess is { HasExited: true })
            {
                throw new InvalidOperationException(
                    "The local server stopped during startup. Check the launcher log for details.");
            }

            try
            {
                using var response = await client.GetAsync(url);
                if ((int)response.StatusCode < 500)
                {
                    return;
                }
            }
            catch (HttpRequestException)
            {
                // The server is still starting.
            }
            catch (TaskCanceledException)
            {
                // The server is still starting.
            }

            await Task.Delay(300);
        }

        throw new TimeoutException(
            "The local server did not become ready within 90 seconds. Check the launcher log for details.");
    }

    private static string FindBrowser()
    {
        var candidates = new List<string>
        {
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                "Microsoft",
                "Edge",
                "Application",
                "msedge.exe"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "Microsoft",
                "Edge",
                "Application",
                "msedge.exe"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "Google",
                "Chrome",
                "Application",
                "chrome.exe"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                "Google",
                "Chrome",
                "Application",
                "chrome.exe")
        };

        foreach (var executableName in new[] { "msedge.exe", "chrome.exe" })
        {
            using var key = Registry.LocalMachine.OpenSubKey(
                @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + executableName);
            if (key?.GetValue(null) is string registeredPath)
            {
                candidates.Add(registeredPath);
            }
        }

        var browser = candidates.FirstOrDefault(File.Exists);
        return browser ?? throw new FileNotFoundException(
            "Microsoft Edge or Google Chrome is required to open Material Maker.");
    }

    private static Process StartBrowser(
        string browserPath,
        string url,
        string stateDirectory)
    {
        var profileDirectory = Path.Combine(stateDirectory, "browser-profile");
        Directory.CreateDirectory(profileDirectory);

        var arguments =
            "--app=\"" + url + "\" " +
            "--user-data-dir=\"" + profileDirectory + "\" " +
            "--no-first-run " +
            "--no-default-browser-check " +
            "--disable-background-mode " +
            "--disable-component-update";

        return Process.Start(
                   new ProcessStartInfo
                   {
                       FileName = browserPath,
                       Arguments = arguments,
                       WorkingDirectory = stateDirectory,
                       UseShellExecute = false
                   }) ??
               throw new InvalidOperationException("The browser process could not be started.");
    }

    private static async Task WaitForBrowserWindowToCloseAsync(IntPtr job)
    {
        var sawWindow = false;
        var noWindowSince = DateTime.MinValue;
        var startupDeadline = DateTime.UtcNow.AddSeconds(30);

        while (true)
        {
            var processIds = GetJobProcessIds(job);
            var hasWindow = HasVisibleTopLevelWindow(processIds);

            if (hasWindow)
            {
                sawWindow = true;
                noWindowSince = DateTime.MinValue;
            }
            else if (sawWindow)
            {
                if (noWindowSince == DateTime.MinValue)
                {
                    noWindowSince = DateTime.UtcNow;
                }
                else if (DateTime.UtcNow - noWindowSince > TimeSpan.FromSeconds(1))
                {
                    return;
                }
            }
            else if (DateTime.UtcNow > startupDeadline)
            {
                throw new TimeoutException("The browser window did not appear.");
            }

            await Task.Delay(250);
        }
    }

    private static HashSet<uint> GetJobProcessIds(IntPtr job)
    {
        const int bufferSize = 65536;
        var buffer = Marshal.AllocHGlobal(bufferSize);

        try
        {
            if (!QueryInformationJobObject(
                    job,
                    JobObjectInfoType.BasicProcessIdList,
                    buffer,
                    (uint)bufferSize,
                    out _))
            {
                throw new System.ComponentModel.Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "Windows could not inspect the browser process group.");
            }

            var processCount = Marshal.ReadInt32(buffer, sizeof(uint));
            var processIds = new HashSet<uint>();
            var firstProcessIdOffset = sizeof(uint) * 2;

            for (var index = 0; index < processCount; index++)
            {
                var processIdPointer = Marshal.ReadIntPtr(
                    buffer,
                    firstProcessIdOffset + index * IntPtr.Size);
                processIds.Add((uint)processIdPointer.ToInt64());
            }

            return processIds;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static bool HasVisibleTopLevelWindow(HashSet<uint> processIds)
    {
        if (processIds.Count == 0)
        {
            return false;
        }

        var found = false;
        EnumWindows(
            (window, _) =>
            {
                GetWindowThreadProcessId(window, out var processId);
                if (processIds.Contains(processId) &&
                    IsWindowVisible(window) &&
                    GetWindowTextLength(window) > 0)
                {
                    found = true;
                    return false;
                }

                return true;
            },
            IntPtr.Zero);

        return found;
    }

    private static IntPtr CreateKillOnCloseJob()
    {
        var job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero)
        {
            throw new System.ComponentModel.Win32Exception(
                Marshal.GetLastWin32Error(),
                "Windows could not create a process job.");
        }

        var information = new JobObjectExtendedLimitInformation
        {
            BasicLimitInformation = new JobObjectBasicLimitInformation
            {
                LimitFlags = JobObjectLimitKillOnJobClose
            }
        };

        var length = Marshal.SizeOf<JobObjectExtendedLimitInformation>();
        var pointer = Marshal.AllocHGlobal(length);

        try
        {
            Marshal.StructureToPtr(information, pointer, false);
            if (!SetInformationJobObject(
                    job,
                    JobObjectInfoType.ExtendedLimitInformation,
                    pointer,
                    (uint)length))
            {
                throw new System.ComponentModel.Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "Windows could not configure process cleanup.");
            }
        }
        catch
        {
            CloseHandle(job);
            throw;
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }

        return job;
    }

    private static void AssignProcessToJobOrThrow(
        IntPtr job,
        Process process,
        string processDescription)
    {
        if (!AssignProcessToJobObject(job, process.Handle))
        {
            throw new System.ComponentModel.Win32Exception(
                Marshal.GetLastWin32Error(),
                "Windows could not attach the " +
                processDescription +
                " to automatic cleanup.");
        }
    }

    private static void Cleanup()
    {
        lock (CleanupLock)
        {
            if (cleanupStarted)
            {
                return;
            }

            cleanupStarted = true;
            Log("Cleanup started.");

            CloseJob(ref serverJob);
            KillProcessTree(serverProcess);
            CloseJob(ref browserJob);
            KillProcessTree(browserProcess);

            Log("Cleanup finished.");
        }
    }

    private static void CloseJob(ref IntPtr job)
    {
        if (job == IntPtr.Zero)
        {
            return;
        }

        CloseHandle(job);
        job = IntPtr.Zero;
    }

    private static void KillProcessTree(Process? process)
    {
        if (process is null)
        {
            return;
        }

        try
        {
            if (!process.HasExited)
            {
                process.Kill(true);
                process.WaitForExit(5000);
            }
        }
        catch
        {
            // Closing the Windows job normally handles the entire tree.
        }
        finally
        {
            process.Dispose();
        }
    }

    private static void Log(string message)
    {
        if (logPath is null)
        {
            return;
        }

        try
        {
            lock (LogLock)
            {
                File.AppendAllText(
                    logPath,
                    string.Format(
                        "{0:O} {1}{2}",
                        DateTimeOffset.Now,
                        message,
                        Environment.NewLine));
            }
        }
        catch
        {
            // Logging must never prevent shutdown.
        }
    }

    private enum JobObjectInfoType
    {
        BasicProcessIdList = 3,
        ExtendedLimitInformation = 9
    }

    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr securityAttributes, string? name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        JobObjectInfoType informationClass,
        IntPtr information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(
        IntPtr job,
        JobObjectInfoType informationClass,
        IntPtr information,
        uint informationLength,
        out uint returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr window);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
}

internal sealed class StartupForm : Form
{
    private readonly Label statusLabel;

    public StartupForm()
    {
        Text = "Starting Forge Material Studio";
        Width = 440;
        Height = 150;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ShowInTaskbar = true;

        var iconPath = Environment.ProcessPath;
        if (!string.IsNullOrWhiteSpace(iconPath))
        {
            Icon = Icon.ExtractAssociatedIcon(iconPath);
        }

        statusLabel = new Label
        {
            AutoSize = false,
            Dock = DockStyle.Top,
            Height = 58,
            Padding = new Padding(20, 18, 20, 0),
            Text = "Preparing Material Maker…",
            TextAlign = ContentAlignment.MiddleLeft
        };

        var progressBar = new ProgressBar
        {
            Dock = DockStyle.Top,
            Height = 18,
            Margin = new Padding(20),
            Style = ProgressBarStyle.Marquee,
            MarqueeAnimationSpeed = 24
        };

        var progressPanel = new Panel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(20, 0, 20, 20)
        };
        progressPanel.Controls.Add(progressBar);

        Controls.Add(progressPanel);
        Controls.Add(statusLabel);
    }

    public void SetStatus(string status)
    {
        if (IsDisposed)
        {
            return;
        }

        statusLabel.Text = status;
    }
}
