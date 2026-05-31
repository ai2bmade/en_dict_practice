param(
  [string]$SourceRoot = "G:\Codex\en_dict_practice_audio\source_mp3",
  [string]$WorkspaceRoot = "C:\Users\pytho\Documents\Codex\2026-05-30\en_dict_practice",
  [string]$FfmpegPath = "G:\Codex\tools\ffmpeg\ffmpeg-8.1.1-essentials_build\bin\ffmpeg.exe"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $FfmpegPath)) {
  throw "ffmpeg.exe not found: $FfmpegPath"
}

$audioPublic = Join-Path $WorkspaceRoot "audio\public"
$contentPath = Join-Path $WorkspaceRoot "content\sentences.json"
$manifestPath = Join-Path $WorkspaceRoot "content\audio_manifest.csv"
New-Item -ItemType Directory -Force -Path $audioPublic | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $manifestPath) | Out-Null

function Convert-ToPublicOgg {
  param(
    [string]$InputPath,
    [string]$OutputPath
  )

  & $FfmpegPath -y -hide_banner -loglevel error `
    -i $InputPath `
    -map_metadata -1 `
    -ac 1 `
    -ar 24000 `
    -c:a libopus `
    -b:a 32k `
    $OutputPath

  if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg failed for $InputPath"
  }
}

function Get-AnswerFromFile {
  param([System.IO.FileInfo]$File)

  $answer = [System.IO.Path]::GetFileNameWithoutExtension($File.Name).Trim()
  if ($answer -notmatch "[.!?]$") {
    $answer = "$answer."
  }
  return $answer
}

$sampleDefinitions = @(
  [ordered]@{
    id = "bgn_000001"
    level = "beginner"
    source = "samples\BGN_sample.mp3"
    answer = "Several packages arrived this morning."
  },
  [ordered]@{
    id = "int_000001"
    level = "intermediate"
    source = "samples\INT_sample.mp3"
    answer = "Several applicants were asked to submit references."
  },
  [ordered]@{
    id = "adv_000001"
    level = "advanced"
    source = "samples\ADV_sample.mp3"
    answer = "Despite weak demand, copper prices could recover by July."
  }
)

$samples = New-Object System.Collections.Generic.List[object]
$sentences = New-Object System.Collections.Generic.List[object]
$manifest = New-Object System.Collections.Generic.List[object]

foreach ($sample in $sampleDefinitions) {
  $sourcePath = Join-Path $SourceRoot $sample.source
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Missing sample audio: $sourcePath"
  }

  $outputName = "$($sample.id).ogg"
  $outputPath = Join-Path $audioPublic $outputName
  Convert-ToPublicOgg -InputPath $sourcePath -OutputPath $outputPath

  $samples.Add([ordered]@{
    id = $sample.id
    level = $sample.level
    answer = $sample.answer
    audio = "audio/public/$outputName"
  })

  $manifest.Add([pscustomobject]@{
    id = $sample.id
    type = "sample"
    level = $sample.level
    answer = $sample.answer
    source_file = $sourcePath
    public_file = $outputPath
  })
}

$levels = @(
  @{ Name = "beginner"; Prefix = "bgn" },
  @{ Name = "intermediate"; Prefix = "int" },
  @{ Name = "advanced"; Prefix = "adv" }
)

foreach ($level in $levels) {
  $levelPath = Join-Path $SourceRoot $level.Name
  if (-not (Test-Path -LiteralPath $levelPath)) {
    throw "Missing level folder: $levelPath"
  }

  $files = Get-ChildItem -File $levelPath -Filter "*.mp3" | Sort-Object Name
  if ($files.Count -ne 20) {
    throw "Expected 20 MP3 files in $levelPath, found $($files.Count)."
  }

  $index = 2
  foreach ($file in $files) {
    $id = "{0}_{1:D6}" -f $level.Prefix, $index
    $answer = Get-AnswerFromFile -File $file
    $outputName = "$id.ogg"
    $outputPath = Join-Path $audioPublic $outputName
    Convert-ToPublicOgg -InputPath $file.FullName -OutputPath $outputPath

    $sentences.Add([ordered]@{
      id = $id
      level = $level.Name
      answer = $answer
      audio = "audio/public/$outputName"
    })

    $manifest.Add([pscustomobject]@{
      id = $id
      type = "practice"
      level = $level.Name
      answer = $answer
      source_file = $file.FullName
      public_file = $outputPath
    })

    $index += 1
  }
}

$content = [ordered]@{
  samples = $samples
  sentences = $sentences
}

$content | ConvertTo-Json -Depth 5 | Set-Content -Path $contentPath -Encoding UTF8
$manifest | Export-Csv -Path $manifestPath -NoTypeInformation -Encoding UTF8

Write-Host "Synced $($samples.Count) samples and $($sentences.Count) practice sentences."
Write-Host "Wrote $contentPath"
Write-Host "Wrote $manifestPath"
