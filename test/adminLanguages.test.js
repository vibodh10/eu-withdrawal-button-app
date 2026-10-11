import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EU_LANGUAGE_CODES, EU_LANGUAGE_OPTIONS, normalizeEuLanguage } from '../shared/euLanguages.js';

function flatten(resource, prefix = '') {
    return Object.fromEntries(Object.entries(resource).flatMap(([key, value]) => {
        const name = prefix ? `${prefix}.${key}` : key;
        return typeof value === 'string' ? [[name, value]] : Object.entries(flatten(value, name));
    }));
}
const read = (code) => JSON.parse(fs.readFileSync(new URL(`../web/src/i18n/locales/${code}.json`, import.meta.url), 'utf8'));
const english = flatten(read('en'));
const placeholders = (text) => [...text.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1]).sort();

test('all 24 admin locales provide the English key set and preserve interpolation', () => {
    assert.equal(EU_LANGUAGE_CODES.length, 24);
    assert.equal(new Set(EU_LANGUAGE_OPTIONS.map(({ value }) => value)).size, 24);
    for (const code of EU_LANGUAGE_CODES) {
        const strings = flatten(read(code));
        // Additional plural categories are allowed for languages that need them.
        for (const [key, value] of Object.entries(english)) {
            assert.ok(typeof strings[key] === 'string' && strings[key].trim(), `${code}.${key} missing`);
            assert.deepEqual(placeholders(strings[key]), placeholders(value), `${code}.${key} placeholders`);
        }
        for (const [key, value] of Object.entries(strings)) {
            assert.ok(value.trim(), `${code}.${key} empty`);
            assert.doesNotMatch(value, /<\/?(?:script|iframe|img)\b/i, `${code}.${key} markup`);
        }
        if (!['en', 'de'].includes(code)) {
            for (const category of new Intl.PluralRules(code).resolvedOptions().pluralCategories) {
                const key = `requests.bulkDelete.description_${category}`;
                assert.ok(strings[key], `${code}.${key} missing plural category`);
                assert.deepEqual(placeholders(strings[key]), ['count'], `${code}.${key} plural interpolation`);
            }
        }
    }
});

test('EU language normalization retains all supported locales and regional bases', () => {
    for (const code of EU_LANGUAGE_CODES) {
        assert.equal(normalizeEuLanguage(code), code);
        assert.equal(normalizeEuLanguage(` ${code.toUpperCase()}-XX `), code);
    }
    for (const unknown of [undefined, null, '', 'xx', '__proto__']) assert.equal(normalizeEuLanguage(unknown), 'en');
});

test('onboarding and Settings use the same language options', () => {
    for (const file of ['web/src/pages/DpaPage.jsx', 'web/src/components/AdminLanguageSelector.jsx']) {
        const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.match(source, /EU_LANGUAGE_OPTIONS as LANGUAGE_OPTIONS/);
        assert.match(source, /options=\{LANGUAGE_OPTIONS\}/);
    }
});

function routes(database) {
    const source = fs.readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
    const start = source.indexOf('adminRouter.post("/dpa/accept"');
    const end = source.indexOf('\nadminRouter.delete(', start);
    const handlers = {};
    vm.runInNewContext(source.slice(start, end), {
        EU_LANGUAGE_CODES,
        prisma: database,
        console: { error() {} },
        adminRouter: {
            post: (url, handler) => { handlers[url] = handler; },
            patch: (url, handler) => { handlers[url] = handler; },
        },
    });
    return handlers;
}

function response() {
    return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('onboarding and locale-save handlers accept all 24 languages and reject unsupported choices', async () => {
    const updates = [];
    const handlers = routes({ shop: { update: async (query) => { updates.push(query); return query.data; } } });
    for (const code of EU_LANGUAGE_CODES) {
        for (const url of ['/dpa/accept', '/admin-locale']) {
            const res = response();
            await handlers[url]({ body: { adminLocale: code }, shop: { id: 'shop-1', dpaAcceptedAt: 'existing-acceptance' } }, res);
            assert.equal(res.statusCode, 200);
            assert.equal(res.body.adminLocale, code);
            const query = updates.at(-1);
            assert.equal(query.where.id, 'shop-1');
            assert.deepEqual(Object.keys(query.data).sort(), url === '/dpa/accept' ? ['adminLocale', 'dpaAcceptedAt'] : ['adminLocale']);
            if (url === '/dpa/accept') assert.equal(query.data.dpaAcceptedAt, 'existing-acceptance');
        }
    }
    const count = updates.length;
    for (const invalid of [undefined, 'xx', 'fr-CA', '__proto__', ['en']]) {
        for (const handler of Object.values(handlers)) {
            const res = response();
            await handler({ body: { adminLocale: invalid }, shop: { id: 'shop-1' } }, res);
            assert.equal(res.statusCode, 400);
        }
    }
    assert.equal(updates.length, count);
});

test('i18next loads additional local JSON on demand and keeps existing English/German resources', async () => {
    const { default: i18next } = await import('i18next');
    const i18n = i18next.createInstance();
    const loaded = [];
    const modules = Object.fromEntries(EU_LANGUAGE_CODES.map((code) => [
        `./locales/${code}.json`, async () => { loaded.push(code); return read(code); },
    ]));
    let source = fs.readFileSync(new URL('../web/src/i18n/index.js', import.meta.url), 'utf8');
    source = source.replace(/^import .*;\n/gm, '')
        .replace('import.meta.glob("./locales/*.json", { import: "default" })', 'localeModulesForTest')
        .replace(/export /g, '')
        .replace('default i18n;', '');
    vm.runInNewContext(source, {
        i18n, initReactI18next: { type: '3rdParty', init() {} },
        en: read('en'), de: read('de'), EU_LANGUAGE_CODES, normalizeEuLanguage,
        localeModulesForTest: modules,
    });
    await i18n.changeLanguage('en');
    assert.equal(i18n.t('onboarding.next'), read('en').onboarding.next);
    await i18n.changeLanguage('de');
    assert.equal(i18n.t('onboarding.next'), read('de').onboarding.next);
    assert.deepEqual(loaded, []);
    for (const language of EU_LANGUAGE_CODES.filter((code) => !['en', 'de'].includes(code))) {
        await i18n.changeLanguage(language);
        assert.equal(i18n.resolvedLanguage, language);
        assert.equal(i18n.t('onboarding.next'), read(language).onboarding.next);
        assert.ok(!i18n.t('settings.email.domain.emailHelp', { domain: 'example.com' }).includes('{{domain}}'));
        assert.ok(!i18n.t('requests.bulkDelete.description', { count: 3 }).includes('{{count}}'));
        for (const count of [0, 1, 2, 3, 5, 11, 21]) {
            const category = new Intl.PluralRules(language).select(count);
            assert.equal(i18n.t('requests.bulkDelete.description', { count }),
                read(language).requests.bulkDelete[`description_${category}`].replace('{{count}}', String(count)));
        }
    }
    assert.deepEqual(loaded.sort(), EU_LANGUAGE_CODES.filter((code) => !['en', 'de'].includes(code)).sort());
    const before = loaded.length;
    await i18n.changeLanguage('fr');
    assert.equal(loaded.length, before, 'loaded resources are retained');
});
