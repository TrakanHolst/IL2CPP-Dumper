param(
    [Parameter(Mandatory=$false)]
    [string]$JsonUrl = "https://cdn1.teamstardust.org/stardust/endfield/0.8.25/CharacterTable.json",
    
    [Parameter(Mandatory=$false)]
    [string]$OutputPath = "localdb\characters.json",
    
    [Parameter(Mandatory=$false)]
    [string]$ImagesPath = "public\assets\images"
)

$ErrorActionPreference = "Stop"

# Get script root directory
$scriptRoot = Split-Path -Parent $PSScriptRoot
if (-not $scriptRoot) { $scriptRoot = (Get-Location).Path }

# Resolve paths
$outputFile = Join-Path $scriptRoot $OutputPath
$imagesRoot = Join-Path $scriptRoot $ImagesPath

# Create image directories
$characterImagesPath = Join-Path $imagesRoot "characters"
$typeImagesPath = Join-Path $imagesRoot "types"
$professionImagesPath = Join-Path $imagesRoot "professions"

New-Item -ItemType Directory -Force -Path $characterImagesPath | Out-Null
New-Item -ItemType Directory -Force -Path $typeImagesPath | Out-Null
New-Item -ItemType Directory -Force -Path $professionImagesPath | Out-Null

Write-Host "Fetching character data from: $JsonUrl" -ForegroundColor Cyan

# Fetch JSON data
$json = Invoke-RestMethod -Uri $JsonUrl

# Type mappings
$typeColors = @{
    "Physical" = "rgb(136, 136, 136)"
    "Fire" = "rgb(255, 98, 61)"
    "Cryst" = "rgb(33, 198, 208)"
    "Pulse" = "rgb(255, 192, 0)"
    "Natural" = "rgb(158, 220, 35)"
}

$typeMapping = @{
    "Physical" = "physical"
    "Fire" = "fire"
    "Cryst" = "cold"
    "Pulse" = "pulse"
    "Natural" = "nature"
}

# Function to download image with browser headers
function Download-Image {
    param(
        [string]$Url,
        [string]$LocalPath
    )
    
    try {
        if (-not (Test-Path $LocalPath)) {
            Write-Host "  Downloading: $(Split-Path -Leaf $LocalPath)" -ForegroundColor Gray
            
            # Use .NET WebClient for better compatibility
            $webClient = New-Object System.Net.WebClient
            $webClient.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            $webClient.Headers.Add("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
            $webClient.DownloadFile($Url, $LocalPath)
            $webClient.Dispose()
            
            # Verify it's a valid image
            $bytes = [System.IO.File]::ReadAllBytes($LocalPath)
            $isPNG = ($bytes.Length -gt 8 -and $bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50 -and $bytes[2] -eq 0x4E)
            $isJPG = ($bytes.Length -gt 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xD8)
            
            if (-not ($isPNG -or $isJPG)) {
                Write-Warning "Downloaded file is not a valid image (got HTML?), deleting..."
                Remove-Item $LocalPath -Force
            }
            
            Start-Sleep -Milliseconds 100  # Rate limiting
        }
    }
    catch {
        Write-Warning "Failed to download $Url : $_"
    }
}

$characterList = @()
$downloadedTypes = @{}
$downloadedProfessions = @{}

# Load existing characters to preserve custom fields
$existingCharacters = @{}
if (Test-Path $outputFile) {
    Write-Host "`nLoading existing characters..." -ForegroundColor Cyan
    $existingData = Get-Content $outputFile -Raw | ConvertFrom-Json
    foreach ($existingChar in $existingData) {
        $existingCharacters[$existingChar.id] = $existingChar
    }
    Write-Host "  Found $($existingCharacters.Count) existing characters" -ForegroundColor Gray
}

Write-Host "`nProcessing characters..." -ForegroundColor Cyan

foreach ($charId in $json.PSObject.Properties.Name | Sort-Object) {
    $char = $json.$charId
    $typeLower = $typeMapping[$char.charTypeId]
    
    Write-Host "Processing: $($char.engName) ($charId)" -ForegroundColor Yellow
    
    # Download character image from Stardust CDN
    $charImageFile = "icon_$charId.png"
    $charImagePath = Join-Path $characterImagesPath $charImageFile
    $charImageUrl = "https://cdn1.teamstardust.org/stardust/endfield/images/characters/$charImageFile"
    Download-Image -Url $charImageUrl -LocalPath $charImagePath
    
    # Download type image from Stardust CDN (once per type)
    $typeImageFile = "icon_charattrtype_$typeLower.png"
    if (-not $downloadedTypes.ContainsKey($typeLower)) {
        $typeImagePath = Join-Path $typeImagesPath $typeImageFile
        $typeImageUrl = "https://cdn1.teamstardust.org/stardust/endfield/images/types/$typeImageFile"
        Download-Image -Url $typeImageUrl -LocalPath $typeImagePath
        $downloadedTypes[$typeLower] = $true
    }
    
    # Download profession image (once per profession)
    $professionId = $char.profession
    if (-not $downloadedProfessions.ContainsKey($professionId)) {
        $professionImageFile = "icon_profession_$professionId.png"
        $professionImagePath = Join-Path $professionImagesPath $professionImageFile
        $professionImageUrl = "https://cdn1.teamstardust.org/stardust/endfield/images/professions/$professionImageFile"
        Download-Image -Url $professionImageUrl -LocalPath $professionImagePath
        $downloadedProfessions[$professionId] = $true
    }
    
    # Build character object with local paths
    $newChar = [PSCustomObject]@{
        id = $charId
        name = $char.engName
        rarity = $char.rarity
        type = $typeLower
        typeColor = $typeColors[$char.charTypeId]
        profession = $professionId
        imageUrl = "/assets/images/characters/$charImageFile"
        typeImageUrl = "/assets/images/types/$typeImageFile"
        professionImageUrl = "/assets/images/professions/icon_profession_$professionId.png"
    }
    
    # Preserve custom fields from existing character (like "obtainable")
    if ($existingCharacters.ContainsKey($charId)) {
        $existingChar = $existingCharacters[$charId]
        # Copy custom properties that aren't in the base schema
        foreach ($prop in $existingChar.PSObject.Properties) {
            if ($prop.Name -notin @('id', 'name', 'rarity', 'type', 'typeColor', 'profession', 'imageUrl', 'typeImageUrl', 'professionImageUrl')) {
                $newChar | Add-Member -NotePropertyName $prop.Name -NotePropertyValue $prop.Value -Force
            }
        }
    }
    
    $characterList += $newChar
}

Write-Host "`nSaving character data to: $outputFile" -ForegroundColor Cyan

# Save JSON with proper formatting
$characterList | ConvertTo-Json -Depth 10 | Set-Content $outputFile

Write-Host "`nComplete!" -ForegroundColor Green
Write-Host "  Characters: $(($characterList | Measure-Object).Count)" -ForegroundColor White
Write-Host "  Output: $outputFile" -ForegroundColor White
Write-Host "`nNote: Using existing character images from project" -ForegroundColor Cyan
