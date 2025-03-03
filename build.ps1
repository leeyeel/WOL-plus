# 设置工作目录
$ScriptDir = Split-Path -Path $MyInvocation.MyCommand.Definition -Parent
$GoProjectDir = "$ScriptDir\client\src\"    # Go项目的源码路径
$BuildDir = "$ScriptDir\build"              # 存放构建结果的目录
$ExecutableName = "wolp.exe"                # 可执行文件名称 

function Build {
    # 确保构建目录存在
    if (-not (Test-Path $BuildDir)) {
        New-Item -Path $BuildDir -ItemType Directory
    }
    # 进入Go项目目录
    Set-Location -Path $GoProjectDir

    # 清理已有的构建文件
    if (Test-Path "$BuildDir\$ExecutableName") {
        Remove-Item "$BuildDir\$ExecutableName" -Force
    }

    # 设置Go环境变量，指定Windows目标平台
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"

    # 编译Go项目为可执行文件
    Write-Host "Building project..."
    go mod tidy
    go build -o "$BuildDir\$ExecutableName"

    # 输出编译结果
    if (Test-Path "$BuildDir\$ExecutableName") {
        Write-Host "Build succeeded! Executable: $BuildDir\$ExecutableName"
    } else {
        Write-Host "Build failed!"
    }

    # 返回到上一级目录
    Set-Location -Path $ScriptDir
}

Build
