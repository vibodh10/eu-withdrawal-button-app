from pathlib import Path

path = Path("web/src/pages/SettingsPage.jsx")
text = path.read_text()

if "Save settings" in text:
    print("Explicit Save settings button already present")
    raise SystemExit(0)

anchor = '''                <Layout>\n                    {state.error && (\n'''
replacement = '''                <Layout>\n                    <Layout.Section>\n                        <InlineStack align="end">\n                            <Button\n                                variant="primary"\n                                onClick={save}\n                                loading={state.saving}\n                                disabled={!hasUnsavedChanges || state.saving}\n                            >\n                                Save settings\n                            </Button>\n                        </InlineStack>\n                    </Layout.Section>\n\n                    {state.error && (\n'''

if anchor not in text:
    raise SystemExit("Could not find the Settings layout anchor")

path.write_text(text.replace(anchor, replacement, 1))
print("Explicit Settings save button added")
