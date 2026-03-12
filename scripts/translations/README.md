# Website Translations Management

This folder contains scripts to manage website translations via Google Sheets.

## Overview

The website supports 7 languages:
- **EN** - English (master)
- **CN** - Simplified Chinese
- **TC** - Traditional Chinese
- **JP** - Japanese
- **KR** - Korean
- **RU** - Russian
- **MX** - Spanish

Translation files are located at: `public/localdb/lang/website_translations_*.json`

---

## Quick Start

### Export Current Translations to CSV

```bash
npm run translations:export
```

This creates 7 CSV files in `scripts/translations/export/` (one per language tab):
- `translations_EN.csv`
- `translations_CN.csv`
- `translations_TC.csv`
- `translations_JP.csv`
- `translations_KR.csv`
- `translations_RU.csv`
- `translations_MX.csv`

### Import Translations from CSV

1. Download each tab from Google Sheets as CSV
2. Save files in `scripts/translations/import/` folder
3. Run:

```bash
npm run translations:import
```

### Validate Translations

```bash
npm run translations:validate
```

---

## Folder Structure

```
scripts/translations/
├── export/                    # Generated CSV files (one per language)
│   ├── translations_EN.csv
│   ├── translations_CN.csv
│   └── ...
├── import/                    # Place downloaded CSVs here (gitignored)
│   ├── translations_EN.csv
│   ├── translations_CN.csv
│   └── ...
├── export-to-csv.js
├── import-from-csv.js
├── validate-translations.js
└── README.md
```

---

## For Translators

### Initial Setup (Google Sheets)

1. Developer exports current translations: `npm run translations:export`
2. Create a new Google Sheet with 7 tabs (one per language)
3. For each language:
   - Create a tab named: EN, CN, TC, JP, KR, RU, or MX
   - File > Import > Upload the corresponding CSV file
   - Choose "Replace current sheet"
4. **Recommended formatting per tab:**
   - Freeze Row 1 (headers)
   - Freeze Column A (keys)
   - Enable word wrap for Column C (Translation)
   - Set column widths: Key=300px, Module=100px, Translation=500px

### Tab Structure (per language)

| Key | Module | Translation |
|-----|--------|-------------|
| app.title | app | EndfieldTools.DEV - Arknights: Endfield Tools... |
| factory.save | factory | Save |
| factory.notifications.saved_to | factory | Saved to "{name}" |

- **Key**: The translation key (do not modify)
- **Module**: Auto-extracted for filtering (use Google Sheets filter)
- **Translation**: The translated text for this language

### Editing Tips

1. **Use the Module column to filter** - Click the filter icon on column B to show only keys from a specific module (e.g., "factory", "characters")

2. **Placeholders must be preserved** - If EN has `{username}`, your translation must also include `{username}` exactly:
   - EN: `Welcome back, {username}!`
   - CN: `欢迎回来，{username}！`
   - JP: `おかえりなさい、{username}さん！`

3. **Leave cells empty if no translation** - Empty cells will fall back to English on the website

4. **Adding new keys** - Add new rows at the bottom. The import script will sort them alphabetically.

5. **Compare with EN tab** - Open EN tab in a separate window to reference the original text

### Submitting Changes

1. Notify the developer that translations are ready
2. Developer downloads each tab as CSV
3. Developer runs import and reviews warnings
4. Developer commits changes

---

## For Developers

### Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Export | `npm run translations:export` | JSON → 7 CSV files |
| Import | `npm run translations:import` | CSV files → JSON |
| Validate | `npm run translations:validate` | Check consistency |

### File Locations

- **Source JSON**: `public/localdb/lang/website_translations_*.json`
- **Export output**: `scripts/translations/export/translations_*.csv`
- **Import input**: `scripts/translations/import/translations_*.csv`

### Import Workflow

1. Create `scripts/translations/import/` folder
2. Download each Google Sheets tab as CSV:
   - Click tab (e.g., "EN")
   - File > Download > Comma Separated Values (.csv)
   - Rename to `translations_EN.csv`
   - Repeat for all languages
3. Place all CSVs in the `import/` folder
4. Run: `npm run translations:import`
5. Review warnings
6. Commit changes

### Import Validation

The import script validates:
- No duplicate keys
- Placeholder consistency (`{name}`, `{username}`, etc.)
- Reports missing translations as warnings

**Errors** (blocking):
- Duplicate keys in CSV
- Invalid CSV format
- Missing EN file (required as master)

**Warnings** (non-blocking):
- Missing translations in non-EN languages
- Placeholder mismatches

### Adding New Translation Keys

1. Add key to EN JSON file (or EN tab in Google Sheets)
2. Export to update all CSV files: `npm run translations:export`
3. Re-import CSVs to Google Sheets
4. Translators add translations in their language tabs
5. Download and import when complete

### Key Naming Convention

Use hierarchical dot notation:
- `{module}.{key}` - Simple keys
- `{module}.{category}.{key}` - Grouped keys

Examples:
- `factory.save`
- `factory.notifications.saved_to`
- `characters.battle_skills`
- `common.cancel`

---

## Troubleshooting

### Import says "Import directory not found"

Create the import folder:
```bash
mkdir scripts/translations/import
```

Then add your CSV files there.

### Import says "EN translation file is required"

The EN CSV must always be present - it's used as the master key list.

### CSV has weird characters

Ensure you're saving with UTF-8 encoding. The export script adds a UTF-8 BOM for Excel compatibility.

### Placeholders not working

Make sure placeholders are exactly as in English:
- Correct: `{username}`
- Wrong: `{ username }`, `{{username}}`, `[username]`

### Keys are out of order after import

This is normal. The import script sorts keys alphabetically for cleaner git diffs.

### Only some languages were imported

The import only processes CSV files that exist in the `import/` folder. Missing files are skipped but won't affect existing JSON files.
