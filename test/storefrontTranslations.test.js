import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildAsset, errorKeys, readTranslations, supportedLanguages, validateTranslations } from '../scripts/buildStorefrontTranslations.js';

const assetUrl = new URL('../extensions/eu-withdrawal-button/assets/withdrawal-button.js', import.meta.url);
const asset = fs.readFileSync(assetUrl, 'utf8');
const translations = readTranslations();
const languages = ['en','de','fr','it','es','pt','nl','pl','da','sv','fi','cs','sk','sl','hr','hu','ro','bg','el','et','lv','lt','ga','mt'];
const coreKeys = ['languageName','heading','name','email','orderNumber','reason','submit','submitting','success','invalidEmail','requiredName','requiredOrderNumber','connectionIssue','withdrawalNotice','fallbackTerms','terms','privacy','contact'];

// Contact and name are genuinely shared words in some languages, not missing translations.
const sharedWords = {
    de: ['name'], fr: ['contact'], nl: ['contact'], pl: ['contact'],
    da: ['contact'], cs: ['contact'], sk: ['contact'], sl: ['contact'], ro: ['contact'],
};

test('all 24 original locales cover every core, accessibility and response key', () => {
    assert.deepEqual(supportedLanguages, languages);
    const files = fs.readdirSync(new URL('../storefront/withdrawal/locales/', import.meta.url)).sort();
    assert.deepEqual(files, languages.map((code) => `${code}.json`).sort());
    validateTranslations(translations);
    for (const code of languages) {
        for (const key of [...coreKeys, 'close', 'language', 'launcher', 'duplicate', 'genericError', ...Object.values(errorKeys)]) {
            assert.ok(translations[code][key], `${code}.${key}`);
        }
        assert.equal((translations[code].withdrawalNotice.match(/\{days\}/g) || []).length, 1);
        if (code === 'en') continue;
        for (const key of Object.keys(translations.en)) {
            if ((sharedWords[code] || []).includes(key)) continue;
            assert.notEqual(translations[code][key], translations.en[key], `${code}.${key}: untranslated English`);
        }
    }
});

test('translation validation rejects missing keys, changed placeholders and markup', () => {
    for (const mutate of [
        (strings) => { delete strings.fr.close; },
        (strings) => { strings.mt.withdrawalNotice = 'Notice {day}'; },
        (strings) => { strings.lv.name = ''; },
        (strings) => { strings.de.name = '<img onerror="alert(1)">'; },
    ]) {
        const strings = structuredClone(translations);
        mutate(strings);
        assert.throws(() => validateTranslations(strings));
    }
});

test('the checked-in Shopify asset contains current resources and both blocks load it unchanged', () => {
    assert.equal(asset, buildAsset());
    for (const block of ['withdrawal-button', 'floating-withdrawal-button']) {
        const liquid = fs.readFileSync(new URL(`../extensions/eu-withdrawal-button/blocks/${block}.liquid`, import.meta.url), 'utf8');
        assert.match(liquid, /'withdrawal-button.js' \| asset_url/);
        assert.match(liquid, /defer/);
    }
    assert.doesNotMatch(asset, /import\s*\(|fetch\([^)]*(?:\.json|locales)/);
});

test('the presentation map covers every existing storefront API error without changing the API', () => {
    for (const file of ['src/routes/proxy.js', 'src/middleware/verifyAppProxy.js']) {
        const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        // Proxy settings errors are logged, not displayed by the form.
        const submission = source.split('proxyRouter.get(')[0];
        for (const match of submission.matchAll(/error:\s*"([^"]+)"/g)) {
            assert.ok(errorKeys[match[1]], `Unmapped API error: ${match[1]}`);
        }
    }
});

// A small DOM boundary harness executes the actual shipping classic script. It
// records markup and events; real layout/native validity remain storefront QA.
class Element {
    constructor(tag = 'div') {
        this.tag = tag;
        this.dataset = {};
        this.style = {};
        this.children = [];
        this.events = {};
        this.classList = { contains: () => false };
        this._html = '';
    }
    appendChild(child) { this.children.push(child); }
    addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
    async fire(name, event = {}) {
        for (const callback of this.events[name] || []) await callback({ target: this, currentTarget: this, preventDefault() {}, ...event });
    }
    set innerHTML(value) {
        this._html = value;
        this.close = new Element('button');
        this.status = new Element('p');
        this.select = value.includes('data-language-select') ? new Element('select') : null;
        this.form = new Element('form');
        this.form.submit = new Element('button');
        this.form.fields = ['customerName', 'customerEmail', 'orderNumber'].map((name) => {
            const field = new Element('input');
            field.name = name;
            field.setCustomValidity = (message) => { field.validationMessage = message; };
            return field;
        });
        this.form.querySelectorAll = () => this.form.fields;
        this.form.querySelector = () => this.form.submit;
        this.form.values = { customerName: 'Customer', customerEmail: 'customer@example.com', orderNumber: '#1234', reason: '' };
        this.form.reset = () => { this.form.wasReset = true; };
    }
    get innerHTML() { return this._html; }
    querySelector(selector) {
        return { '[data-close]': this.close, '[data-status]': this.status, '[data-language-select]': this.select, '[data-form]': this.form }[selector];
    }
}

function storefront({ settings = {}, locale = 'en', label = 'EU Withdrawal Request', floating = false, failSettings = false, code = asset } = {}) {
    const root = new Element();
    root.dataset = { locale, buttonLabel: label };
    root.classList.contains = () => floating;
    const body = new Element('body');
    const requests = [];
    let response = { ok: true, data: { reference: 'REF-1' } };
    const document = { querySelectorAll: () => [root], createElement: (tag) => new Element(tag), body };
    const context = vm.createContext({
        document,
        console: { log() {}, error() {} },
        setTimeout() {},
        FormData: class { constructor(form) { this.form = form; } entries() { return Object.entries(this.form.values); } },
        fetch: async (url, options) => {
            requests.push({ url, options });
            if (url.endsWith('/settings')) {
                if (failSettings) throw new Error('Offline');
                return { json: async () => settings };
            }
            if (response.networkError) throw new Error('Offline');
            return { ok: response.ok, json: async () => response.data };
        },
    });
    vm.runInContext(code, context);
    const wrapper = floating ? body.children[0] : root.children[0];
    const modal = body.children.at(-1);
    return {
        root, body, wrapper, modal, button: wrapper.children[0], requests,
        replay: () => vm.runInContext(code, context),
        respond: (next) => { response = next; },
    };
}

for (const language of languages) {
    test(`${language}: resources render, switch, validate, translate API responses and preserve submission payload`, async () => {
        const page = storefront({ settings: { defaultLanguage: `${language}-XX`, enabledLanguages: languages, withdrawalDays: 30 } });
        assert.equal(page.requests.length, 0, 'no translation resource request during startup');
        await page.button.fire('click');
        assert.equal(page.modal.lang, language);
        assert.equal(page.button.textContent, translations[language].launcher);
        assert.ok(page.modal.innerHTML.includes(translations[language].withdrawalNotice.replace('{days}', '30')));
        assert.ok(page.modal.innerHTML.includes(`aria-label="${translations[language].close}"`));
        assert.ok(page.modal.innerHTML.includes(`aria-label="${translations[language].language}"`));
        assert.match(page.modal.innerHTML, /role="status" aria-live="polite"/);
        for (const field of page.modal.form.fields) {
            await field.fire('invalid');
            const key = field.name === 'customerEmail' ? 'invalidEmail' : field.name === 'customerName' ? 'requiredName' : 'requiredOrderNumber';
            assert.equal(field.validationMessage, translations[language][key]);
            await field.fire('input');
            assert.equal(field.validationMessage, '');
        }
        for (const [message, key] of Object.entries(errorKeys)) {
            page.respond({ ok: false, data: { error: message } });
            await page.modal.form.fire('submit');
            assert.equal(page.modal.status.textContent, translations[language][key]);
            assert.equal(page.modal.form.submit.disabled, false);
        }
        page.respond({ ok: false, data: { error: '<img src=x onerror=alert(1)>' } });
        await page.modal.form.fire('submit');
        assert.equal(page.modal.status.textContent, translations[language].genericError);
        page.respond({ ok: true, data: { duplicate: true, message: 'English server duplicate text' } });
        await page.modal.form.fire('submit');
        assert.equal(page.modal.status.textContent, translations[language].duplicate);
        page.respond({ ok: true, data: { reference: 'REF-1' } });
        page.modal.form.values.customerName = ' Customer ';
        await page.modal.form.fire('submit');
        assert.equal(page.modal.status.textContent, `${translations[language].success} REF-1`);
        assert.equal(page.modal.form.wasReset, true);
        const request = page.requests.at(-1);
        assert.equal(request.url, '/apps/eu-withdrawal/withdrawal-request');
        assert.equal(request.options.method, 'POST');
        assert.deepEqual(JSON.parse(request.options.body), {
            customerName: 'Customer', customerEmail: 'customer@example.com', orderNumber: '#1234', reason: '', locale: language, legalCopyVersion: 'v1',
        });
        page.respond({ networkError: true });
        await page.modal.form.fire('submit');
        assert.equal(page.modal.status.textContent, translations[language].connectionIssue);
        const next = language === 'en' ? 'de' : 'en';
        await page.modal.select.fire('change', { target: { value: next } });
        assert.equal(page.modal.lang, next);
        assert.equal(page.button.textContent, translations[next].launcher);
    });
}

test('language fallback, merchant-enabled languages and custom launcher labels are preserved', async () => {
    for (const [settings, expected] of [
        [{ defaultLanguage: 'xx', enabledLanguages: ['xx','de','fr'] }, 'de'],
        [{ defaultLanguage: 'fr', enabledLanguages: ['en','de'] }, 'en'],
        [{ defaultLanguage: '', enabledLanguages: ['fr','de'] }, 'fr'],
        [{ defaultLanguage: 'de', enabledLanguages: ['de'] }, 'de'],
        [{ defaultLanguage: 'xx', enabledLanguages: [] }, 'en'],
    ]) {
        const page = storefront({ settings, locale: 'fr-CA', label: 'Merchant wording' });
        await page.button.fire('click');
        assert.equal(page.modal.lang, expected);
        assert.equal(page.button.textContent, 'Merchant wording');
        assert.equal(!!page.modal.select, (settings.enabledLanguages.filter((code) => languages.includes(code)).length > 1));
        assert.ok(!page.modal.innerHTML.includes('value="xx"'));
    }
    const page = storefront({ failSettings: true, locale: 'de-DE' });
    assert.equal(page.button.textContent, translations.de.launcher);
    await page.button.fire('click');
    assert.equal(page.modal.lang, 'en', 'existing settings-fetch failure fallback');
});

test('repeated asset loads initialise each root once and retain floating positioning', async () => {
    for (const floating of [false, true]) {
        const page = storefront({ floating });
        page.replay();
        assert.equal(page.body.children.length, floating ? 2 : 1);
        assert.equal(page.root.children.length, floating ? 0 : 1);
        assert.equal(page.button.events.click.length, 1);
        if (floating) {
            assert.equal(page.wrapper.style.position, 'fixed');
            assert.equal(page.wrapper.style.bottom, '24px');
            assert.equal(page.wrapper.style.right, '24px');
        }
        await page.button.fire('click');
        await page.modal.close.fire('click');
        assert.equal(page.modal.style.display, 'none');
    }
});

test('translated quotes are escaped in attributes and interpolated text cannot inject HTML', async () => {
    const resources = structuredClone(translations);
    resources.en.name = 'Name " autofocus onfocus="alert(1)';
    resources.en.close = 'Close & "return"';
    const page = storefront({ code: buildAsset(resources), settings: { withdrawalDays: '<img src=x onerror=alert(1)>' } });
    await page.button.fire('click');
    assert.ok(page.modal.innerHTML.includes('aria-label="Name &quot; autofocus onfocus=&quot;alert(1)"'));
    assert.ok(page.modal.innerHTML.includes('aria-label="Close &amp; &quot;return&quot;"'));
    assert.ok(page.modal.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(!page.modal.innerHTML.includes('<img'));
});

test('page and floating blocks coexist without sharing selected-language state', async () => {
    const roots = [new Element(), new Element()];
    roots[0].dataset = { locale: 'fr', buttonLabel: 'EU Withdrawal Request' };
    roots[1].dataset = { locale: 'fr', buttonLabel: 'EU Withdrawal Request' };
    roots[1].classList.contains = () => true;
    const body = new Element('body');
    const context = vm.createContext({
        document: { querySelectorAll: () => roots, createElement: (tag) => new Element(tag), body },
        console: { log() {}, error() {} },
        fetch: async () => ({ json: async () => ({ defaultLanguage: 'fr', enabledLanguages: ['fr', 'de'] }) }),
    });
    vm.runInContext(asset, context);
    vm.runInContext(asset, context);
    assert.equal(roots[0].children.length, 1);
    assert.equal(body.children.length, 3);
    const pageButton = roots[0].children[0].children[0];
    const floatingButton = body.children[1].children[0];
    const pageModal = body.children[0];
    const floatingModal = body.children[2];
    await pageButton.fire('click');
    await floatingButton.fire('click');
    await pageModal.select.fire('change', { target: { value: 'de' } });
    assert.equal(pageModal.lang, 'de');
    assert.equal(floatingModal.lang, 'fr');
    assert.equal(pageButton.textContent, translations.de.launcher);
    assert.equal(floatingButton.textContent, translations.fr.launcher);
});
