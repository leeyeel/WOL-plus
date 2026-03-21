; wolp.iss - Inno Setup Script
; 可通过命令行参数传入版本号: ISCC.exe /DVERSION=0.0.5 windows_x86_64.iss

#ifndef VERSION
  #define VERSION "dev"
#endif

#ifndef APP_ARCH
  #define APP_ARCH "amd64"
#endif

#ifndef BACKEND_ONLY
  #define BACKEND_ONLY "0"
#endif

#ifndef BUILD_ROOT
  #define BUILD_ROOT AddBackslash(SourcePath) + "..\build\windows\" + APP_ARCH
#endif

#if "1" == BACKEND_ONLY
  #define VARIANT_SUFFIX "backend-only"
  #define MyServiceConfigPath AddBackslash(SourcePath) + "wolp-service-backend-only.xml"
#else
  #define VARIANT_SUFFIX "with-webui"
  #define MyServiceConfigPath AddBackslash(SourcePath) + "wolp-service.xml"
#endif

#define MyAppName "wolp"
#define MyAppExeName "wolp-service.exe"
#define MyBinaryPath BUILD_ROOT + "\wolp.exe"
#define MyServiceWrapperPath BUILD_ROOT + "\wolp-service.exe"

[Setup]
AppName={#MyAppName}
AppVersion={#VERSION}
AppPublisher=leo
AppPublisherURL=https://github.com/leeyeel/WOL-plus
OutputBaseFilename=installer_windows_{#APP_ARCH}_{#VARIANT_SUFFIX}_v{#VERSION}
DefaultDirName={commonpf}\{#MyAppName}
DefaultGroupName={#MyAppName}
PrivilegesRequired=admin
SetupIconFile="{#SourcePath}\icon.ico"

#if APP_ARCH == "arm64"
ArchitecturesAllowed=arm64
ArchitecturesInstallIn64BitMode=arm64
#else
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#endif

[Files]
Source: "{#MyBinaryPath}"; DestDir: "{app}"; Flags: ignoreversion
#if "1" != BACKEND_ONLY
Source: "{#SourcePath}\..\client\webui\*"; DestDir: "{app}\webui"; Flags: recursesubdirs createallsubdirs ignoreversion
#endif
Source: "{#SourcePath}\icon.ico"; DestDir: "{app}"; Flags: onlyifdoesntexist
Source: "{#MyServiceConfigPath}"; DestDir: "{app}"; DestName: "wolp-service.xml"; Flags: ignoreversion
Source: "{#MyServiceWrapperPath}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\wolp"; Filename: "{app}\wolp.exe"; IconFilename: "{app}\icon.ico"

[Run]
Filename: "{app}\{#MyAppExeName}"; Parameters: "install wolp-service.xml";
Filename: "{app}\{#MyAppExeName}"; Parameters: "start";

[UninstallRun]
Filename: "{app}\{#MyAppExeName}"; Parameters: "stop";Flags: runhidden; RunOnceId: "StopService";
Filename: "{app}\{#MyAppExeName}"; Parameters: "uninstall";Flags: runhidden; RunOnceId: "UninstallService"

[UninstallDelete]
Type: files; Name: "{app}\wolp-service.log"
Type: files; Name: "{app}\wolp-service.err.log"
Type: files; Name: "{app}\wolp-service.exe"
Type: files; Name: "{app}\wolp-service.xml"
Type: files; Name: "{app}\wolp.exe"
Type: dirifempty; Name: "{app}"


[Code]
function IsAlreadyInstalled: Boolean;
begin
  Result := RegKeyExists(HKEY_LOCAL_MACHINE, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#MyAppName}_is1');
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if IsAlreadyInstalled then
  begin
    MsgBox('{#MyAppName} 已安装在您的计算机上，请先卸载再进行安装！', mbError, MB_OK);
    Result := False;
  Exit;
end;
end;
