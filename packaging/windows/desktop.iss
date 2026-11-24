[Setup]
AppId=network.unsocial.desktop
AppName=Unsocial Network
AppVersion={#AppVersion}
AppPublisher=Unsocial Network
AppPublisherURL=https://tech-decode-daily.github.io/unsocial-network/
DefaultDirName={localappdata}\Programs\Unsocial Network
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
DisableDirPage=yes
WizardStyle=modern
UninstallDisplayIcon={app}\Unsocial Network.exe
OutputDir={#OutputPath}
OutputBaseFilename=Unsocial-Network-{#AppVersion}-Windows-x64-Setup
Compression=lzma2/fast
SolidCompression=yes
SetupLogging=yes
CloseApplications=yes
RestartApplications=no

[Files]
Source: "{#PayloadPath}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Unsocial Network"; Filename: "{app}\Unsocial Network.exe"

[Run]
Filename: "{app}\Unsocial Network.exe"; Description: "Open Unsocial Network"; Flags: postinstall nowait skipifsilent
