param(
    [ValidateSet("amd64", "arm64")]
    [string]$Arch = "amd64",
    [string]$Version = "dev"
)

$ScriptDir = Split-Path -Path $MyInvocation.MyCommand.Definition -Parent
$RepoRoot = Split-Path -Path $ScriptDir -Parent
$GoProjectDir = Join-Path $RepoRoot "client\src"
$BuildDir = Join-Path $RepoRoot "build\windows\$Arch"
$ExecutableName = "wolp.exe"
$ServiceWrapperName = "wolp-service.exe"

function Build() {
    New-Item -Path $BuildDir -ItemType Directory -Force | Out-Null
    Push-Location -Path $GoProjectDir

    if (Test-Path (Join-Path $BuildDir $ExecutableName)) {
        Remove-Item (Join-Path $BuildDir $ExecutableName) -Force
    }

    $env:GOOS = "windows"
    $env:GOARCH = $Arch
    $env:CGO_ENABLED = "0"

    Write-Host "Building project for windows/$Arch..."
    go build -trimpath -ldflags "-s -w" -o (Join-Path $BuildDir $ExecutableName) .

    if (-not (Test-Path (Join-Path $BuildDir $ExecutableName))) {
        throw "Build failed!"
    }

    Write-Host "Build succeeded! Executable: $(Join-Path $BuildDir $ExecutableName)"
    Pop-Location
}

function Download-WinSW() {
    $winswArch = if ($Arch -eq "arm64") { "arm64" } else { "x64" }
    $winSWPath = Join-Path $BuildDir $ServiceWrapperName
    $downloadURL = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-$winswArch.exe"

    Write-Host "Downloading WinSW for $Arch from $downloadURL"
    Invoke-WebRequest -Uri $downloadURL -OutFile $winSWPath
    Write-Host "Downloaded WinSW wrapper: $winSWPath"
}

Build
Download-WinSW
