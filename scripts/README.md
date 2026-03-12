# Character Update Script

## Usage

### Basic Usage (Default Settings)
```powershell
.\scripts\update-characters.ps1
```

This will:
- Fetch data from `https://cdn1.teamstardust.org/stardust/endfield/0.8.25/CharacterTable.json`
- Download all character, type, and profession images to `public\assets\images\`
- Save the updated character list to `localdb\characters.json` with local image paths

### Custom JSON URL
```powershell
.\scripts\update-characters.ps1 -JsonUrl "https://example.com/custom-characters.json"
```

### Custom Output Path
```powershell
.\scripts\update-characters.ps1 -OutputPath "data\my-characters.json"
```

### Custom Images Directory
```powershell
.\scripts\update-characters.ps1 -ImagesPath "public\custom-images"
```

### All Parameters
```powershell
.\scripts\update-characters.ps1 `
    -JsonUrl "https://example.com/characters.json" `
    -OutputPath "localdb\characters.json" `
    -ImagesPath "public\assets\images"
```

## Features

- ✅ Downloads character images from endfieldtools.dev
- ✅ Downloads type and profession icons
- ✅ Skips already downloaded images (incremental updates)
- ✅ Rate limiting to avoid overwhelming servers
- ✅ Converts web URLs to local paths in JSON
- ✅ Creates necessary directories automatically
- ✅ Color-coded console output

## Output

The script creates the following structure:

```
public/
  assets/
    images/
      characters/
        icon_chr_0002_endminm.png
        icon_chr_0003_endminf.png
        ...
      types/
        icon_charattrtype_physical.png
        icon_charattrtype_fire.png
        icon_charattrtype_cold.png
        icon_charattrtype_pulse.png
        icon_charattrtype_nature.png
      professions/
        icon_profession_0.png
        icon_profession_2.png
        ...

localdb/
  characters.json  (with local paths like "/assets/images/characters/...")
```

## JSON Format

The generated `characters.json` contains:

```json
[
  {
    "id": "chr_0004_pelica",
    "name": "Perlica",
    "rarity": 5,
    "type": "pulse",
    "typeColor": "rgb(255, 192, 0)",
    "profession": 5,
    "imageUrl": "/assets/images/characters/icon_chr_0004_pelica.png",
    "typeImageUrl": "/assets/images/types/icon_charattrtype_pulse.png",
    "professionImageUrl": "/assets/images/professions/icon_profession_5.png"
  },
  ...
]
```
