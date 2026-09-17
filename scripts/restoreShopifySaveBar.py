from pathlib import Path
import re

path = Path("web/src/pages/SettingsPage.jsx")
text = path.read_text()

# Use Shopify App Bridge's actual SaveBar React component.
old_import = '} from "@shopify/polaris";\n'
new_import = '} from "@shopify/polaris";\nimport { SaveBar } from "@shopify/app-bridge-react";\n'
if 'import { SaveBar } from "@shopify/app-bridge-react";' not in text:
    if old_import not in text:
        raise SystemExit("Polaris import anchor not found")
    text = text.replace(old_import, new_import, 1)

# Remove the hidden-input/data-save-bar bridge. Shopify recommends using either
# automatic form integration OR the SaveBar API/component, not both.
text = text.replace('    const dirtyBridgeRef = useRef(null);\n', '')
text = text.replace('    const dirtyBridgeReadyRef = useRef(false);\n', '')

text, count = re.subn(
    r'\n    /\*\n     \* Shopify\'s automatic save bar watches this native hidden input\..*?\n    \}, \[form, templateLoaded\]\);\n',
    '\n',
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"Automatic save-bar bridge effect removal matched {count} blocks")

text, count = re.subn(
    r'\n    function syncAutomaticSaveBarBaseline\(nextForm\) \{.*?\n    \}\n',
    '\n',
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"syncAutomaticSaveBarBaseline removal matched {count} blocks")

text = text.replace('        dirtyBridgeReadyRef.current = false;\n', '')
text = text.replace('                data-save-bar\n', '')

text, count = re.subn(
    r'\n                <input\n                    ref=\{dirtyBridgeRef\}\n                    type="hidden"\n                    name="settingsState"\n                    defaultValue=""\n                />\n',
    '\n',
    text,
    count=1,
)
if count != 1:
    raise SystemExit(f"Hidden save-bar bridge input removal matched {count} blocks")

# Remove the temporary inline page button that was added as a workaround.
text, count = re.subn(
    r'\n                    <Layout\.Section>\n                        <InlineStack align="end">\n                            <Button\n                                variant="primary"\n                                onClick=\{save\}\n                                loading=\{state\.saving\}\n                                disabled=\{!hasUnsavedChanges \|\| state\.saving\}\n                            >\n                                Save settings\n                            </Button>\n                        </InlineStack>\n                    </Layout\.Section>\n',
    '\n',
    text,
    count=1,
)
if count != 1:
    raise SystemExit(f"Temporary inline Save settings button removal matched {count} blocks")

# Put back the real Shopify contextual SaveBar component, controlled by the
# existing dirty-state calculation and existing save/reset handlers.
main_anchor = '''    return (\n        <Page title="Settings">\n            <form\n'''
main_replacement = '''    return (\n        <Page title="Settings">\n            <SaveBar id="settings-save-bar" open={hasUnsavedChanges}>\n                <button\n                    variant="primary"\n                    onClick={save}\n                    disabled={state.saving}\n                >\n                    Save\n                </button>\n                <button\n                    onClick={() => formElementRef.current?.reset()}\n                    disabled={state.saving}\n                >\n                    Discard\n                </button>\n            </SaveBar>\n\n            <form\n'''
if main_anchor not in text:
    raise SystemExit("Main Settings page anchor not found")
text = text.replace(main_anchor, main_replacement, 1)

# Safety checks.
required = [
    'import { SaveBar } from "@shopify/app-bridge-react";',
    '<SaveBar id="settings-save-bar" open={hasUnsavedChanges}>',
    'onClick={save}',
    'onClick={() => formElementRef.current?.reset()}',
]
for item in required:
    if item not in text:
        raise SystemExit(f"Required SaveBar pattern missing: {item}")

forbidden = [
    'data-save-bar',
    'dirtyBridgeRef',
    'dirtyBridgeReadyRef',
    'Save settings',
]
for item in forbidden:
    if item in text:
        raise SystemExit(f"Old save implementation still present: {item}")

path.write_text(text)
print("Shopify App Bridge SaveBar restored")
