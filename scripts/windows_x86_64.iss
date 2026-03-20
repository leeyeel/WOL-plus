; wolp.iss - Inno Setup Script
; 可通过命令行参数传入版本号: ISCC.exe /DVERSION=0.0.5 windows_x86_64.iss

#ifndef VERSION
  #define VERSION "1.0.0"
#endif

#define MyAppName "wolp"
#define MyAppExeName "wolp-service.exe"

[Setup]
AppName={#MyAppName}
AppVersion={#VERSION}
AppPublisher=leo
AppPublisherURL=https://github.com/leeyeel/WOL-plus
OutputBaseFilename=installer_windows_inno_x64_v{#VERSION}
DefaultDirName={commonpf}\{#MyAppName}
DefaultGroupName={#MyAppName}
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile="{#SourcePath}\icon.ico"

[Files]
Source: "{#SourcePath}\..\build\wolp.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\..\client\webui\*"; DestDir: "{app}\webui"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#SourcePath}\icon.ico"; DestDir: "{app}"; Flags: onlyifdoesntexist
Source: "{#SourcePath}\wolp-service.xml"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\wolp-service.exe"; DestDir: "{app}"; Flags: ignoreversion

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
Type: files; Name: "{app}\winsw.exe"
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
