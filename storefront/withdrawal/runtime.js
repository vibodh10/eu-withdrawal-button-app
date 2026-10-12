(function () {
    const roots = document.querySelectorAll(
        '.eu-withdrawal-button-root, .eu-withdrawal-floating-root'
    );

    roots.forEach((root) => {
        if (root.dataset.euWithdrawalInitialized === "true") {
            return;
        }

        root.dataset.euWithdrawalInitialized = "true";

        const appUrl = root.dataset.appUrl;
        const shopDomain = root.dataset.shopDomain;
        const locale = root.dataset.locale || 'en';
        const buttonLabel = root.dataset.buttonLabel;
        const defaultButtonLabels = ['EU Withdrawal Request', 'Exercise your right to withdraw'];
        const customButtonLabel = buttonLabel && !defaultButtonLabels.includes(buttonLabel);
        const isFloating = root.classList.contains('eu-withdrawal-floating-root');
        const position = root.dataset.position || 'bottom-right';
        const bottomOffset = Number(root.dataset.bottomOffset || 24);
        const sideOffset = Number(root.dataset.sideOffset || 24);
        const buttonBg = root.dataset.buttonBg || '#0041c2';
        const buttonText = root.dataset.buttonText || '#fff';

        const wrapper = document.createElement('div');

        if (isFloating) {
            wrapper.style.position = 'fixed';
            wrapper.style.zIndex = '9998';
            wrapper.style.bottom = `${bottomOffset}px`;

            if (position === 'bottom-left') {
                wrapper.style.left = `${sideOffset}px`;
            } else if (position === 'bottom-center') {
                wrapper.style.left = '50%';
                wrapper.style.transform = 'translateX(-50%)';
            } else {
                wrapper.style.right = `${sideOffset}px`;
            }
        } else {
            wrapper.style.margin = '0';
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = customButtonLabel
            ? buttonLabel
            : translationForLanguage(normaliseLanguage(locale)).launcher;
        button.style.padding = '12px 18px';
        button.style.borderRadius = '999px';
        button.style.border = `1px solid ${buttonBg}`;
        button.style.background = buttonBg;
        button.style.color = buttonText;
        button.style.cursor = 'pointer';
        button.style.boxShadow = isFloating ? '0 8px 24px rgba(0,0,0,.18)' : 'none';
        button.style.fontWeight = '600';

        const modal = document.createElement('div');
        modal.style.display = 'none';
        modal.style.position = 'fixed';
        modal.style.inset = '0';
        modal.style.background = 'rgba(0,0,0,.5)';
        modal.style.zIndex = '9999';

        // 🧠 SETTINGS (will be fetched)
        let settings = {
            withdrawalDays: 14,
            legalPageUrl: null,
            privacyPageUrl: null,
            supportEmail: null,
            showPoweredBy: true,
            poweredByText: "Powered by GL6",
            defaultLanguage: "en",
            enabledLanguages: ["en", "de"]
        };

        let currentLanguage = "en";

        function normaliseLanguage(code) {
            return String(code || "en").toLowerCase().split("-")[0];
        }

        function getEnabledLanguages() {
            const enabled = Array.isArray(settings.enabledLanguages)
                ? settings.enabledLanguages
                : ["en", "de"];

            return enabled.filter((code) => Object.hasOwn(TRANSLATIONS, code));
        }

        function translationForLanguage(code) {
            return Object.hasOwn(TRANSLATIONS, code) ? TRANSLATIONS[code] : TRANSLATIONS.en;
        }

        function t(key) {
            const lang = translationForLanguage(currentLanguage);
            return lang[key] || TRANSLATIONS.en[key] || key;
        }

        // Translation resources contain plain text. Escape at HTML/attribute boundaries;
        // status messages and the launcher use textContent instead.
        function escapeHtml(value) {
            return String(value ?? "").replace(/[&<>"']/g, (character) => ({
                "&": "&amp;", "<": "&lt;", ">": "&gt;",
                '"': "&quot;", "'": "&#39;",
            })[character]);
        }

        function htmlText(key) {
            return escapeHtml(t(key));
        }

        function updateLauncher() {
            if (!customButtonLabel) button.textContent = t("launcher");
        }

        function errorText(message) {
            const key = Object.hasOwn(ERROR_KEYS, message) ? ERROR_KEYS[message] : "genericError";
            return t(key);
        }

        function formatText(value) {
            return String(value || "").replaceAll("{days}", settings.withdrawalDays || 14);
        }

        function buildLanguageOptionsHtml() {
            const enabled = getEnabledLanguages();

            if (enabled.length <= 1) {
                return "";
            }

            return `
    <select data-language-select aria-label="${htmlText("language")}" style="
      padding:8px 10px;
      border:1px solid #d1d5db;
      border-radius:8px;
      background:#fff;
      font-size:14px;
      cursor:pointer;
    ">
      ${enabled.map((code) => {
                const label = TRANSLATIONS[code]?.languageName || code.toUpperCase();
                return `<option value="${code}" ${code === currentLanguage ? "selected" : ""}>${escapeHtml(label)}</option>`;
            }).join("")}
    </select>
  `;
        }

        async function loadSettings() {
            try {
                const res = await fetch("/apps/eu-withdrawal/settings")

                const data = await res.json();

                settings = { ...settings, ...data };
                console.log("LANGUAGE DEBUG:", {
                    backendDefaultLanguage: settings.defaultLanguage,
                    storefrontLocale: locale,
                    enabledLanguages: settings.enabledLanguages
                });

                const enabled = getEnabledLanguages();

                const preferredLanguage = normaliseLanguage(
                    settings.defaultLanguage || locale || "en"
                );

                currentLanguage = enabled.includes(preferredLanguage)
                    ? preferredLanguage
                    : enabled.includes("en")
                        ? "en"
                        : enabled[0];

                console.log("EU Withdrawal settings loaded:", settings);
                console.log("EU Withdrawal current language:", currentLanguage);
            } catch (e) {
                console.error("Settings fetch failed", e);
            }
        }

        function buildComplianceHtml() {
            let html = `
    <p style="margin:6px 0 0;">
      ${escapeHtml(formatText(t("withdrawalNotice")))}
    </p>
  `;

            if (settings.legalPageUrl || settings.privacyPageUrl) {
                html += `<p style="margin:6px 0 0;">`;

                if (settings.legalPageUrl) {
                    html += `<a href="${settings.legalPageUrl}" target="_blank">${htmlText("terms")}</a>`;
                }

                if (settings.legalPageUrl && settings.privacyPageUrl) {
                    html += ` · `;
                }

                if (settings.privacyPageUrl) {
                    html += `<a href="${settings.privacyPageUrl}" target="_blank">${htmlText("privacy")}</a>`;
                }

                html += `</p>`;
            }

            if (settings.supportEmail) {
                html += `
      <p style="margin:6px 0 0;">
        ${htmlText("contact")}: <a href="mailto:${settings.supportEmail}">${settings.supportEmail}</a>
      </p>
    `;
            }

            return html;
        }

        function buildModal() {
            modal.lang = currentLanguage || "en";
            updateLauncher();
            modal.innerHTML = `
    <div style="
      max-width:520px;
      margin:8vh auto;
      background:#fff;
      border-radius:16px;
      padding:24px;
      font-family:Arial,sans-serif;
    ">
      
      <div style="
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:16px;
      ">
        <h3 style="margin:0;">${htmlText("heading")}</h3>

        <div style="
          display:flex;
          align-items:center;
          gap:8px;
        ">
          ${buildLanguageOptionsHtml()}

          <button
            type="button"
            data-close
            aria-label="${htmlText("close")}"
            style="
              border:0;
              background:transparent;
              font-size:24px;
              cursor:pointer;
            "
          >
            ×
          </button>
        </div>
      </div>

      <form data-form style="margin-top:20px;display:grid;gap:12px;">
        
        <input
          name="customerName"
          aria-label="${htmlText("name")}"
          placeholder="${htmlText("name")}"
          required
          autocomplete="name"
          style="padding:12px;border:1px solid #ccc;border-radius:10px;"
        />
        
        <input
          name="customerEmail"
          aria-label="${htmlText("email")}"
          placeholder="${htmlText("email")}"
          required
          type="email"
          style="padding:12px;border:1px solid #ccc;border-radius:10px;"
        />
        
        <input
          name="orderNumber"
          aria-label="${htmlText("orderNumber")}"
          placeholder="${htmlText("orderNumber")}"
          required
          autocomplete="off"
          style="padding:12px;border:1px solid #ccc;border-radius:10px;"
        />
        
        <textarea
          name="reason"
          aria-label="${htmlText("reason")}"
          placeholder="${htmlText("reason")}"
          rows="4"
          style="padding:12px;border:1px solid #ccc;border-radius:10px;"
        ></textarea>

        <div style="font-size:12px; color:#666; line-height:1.5;">
          ${buildComplianceHtml()}
        </div>

        <button
          type="submit"
          style="
            padding:12px 18px;
            border-radius:999px;
            border:0;
            background:#0041c2;
            color:#fff;
            cursor:pointer;
          "
        >
          ${htmlText("submit")}
        </button>

        <p data-status role="status" aria-live="polite" style="margin:0;font-size:14px;min-height:18px;"></p>
      </form>
    </div>
  `;
        }

        button.addEventListener('click', async () => {
            if (!modal.innerHTML) {
                await loadSettings(); // ✅ fetch BEFORE rendering
                buildModal();
                attachModalEvents();
            }
            modal.style.display = 'block';
        });

        function attachModalEvents() {
            modal.querySelector('[data-close]').addEventListener('click', () => {
                modal.style.display = 'none';
            });

            modal.addEventListener('click', (event) => {
                if (event.target === modal) {
                    modal.style.display = 'none';
                }
            });

            const languageSelect = modal.querySelector("[data-language-select]");

            if (languageSelect) {
                languageSelect.addEventListener("change", (event) => {
                    currentLanguage = event.target.value;
                    buildModal();
                    attachModalEvents();
                });
            }

            const formElement = modal.querySelector('[data-form]');
            // Keep native required/email validation, using the selected form language
            // rather than the browser UI language for its validation bubble.
            formElement.querySelectorAll('input').forEach((input) => {
                input.addEventListener('input', () => input.setCustomValidity(""));
                input.addEventListener('invalid', () => {
                    const key = input.name === "customerEmail" ? "invalidEmail"
                        : input.name === "customerName" ? "requiredName" : "requiredOrderNumber";
                    input.setCustomValidity(t(key));
                });
            });

            formElement.addEventListener('submit', async (event) => {
                event.preventDefault();

                const form = event.currentTarget;
                const status = modal.querySelector('[data-status]');
                const submitBtn = form.querySelector('button[type="submit"]');

                submitBtn.disabled = true;
                status.style.color = '#666';
                status.textContent = t("submitting");

                const formData = new FormData(form);
                const payload = Object.fromEntries(formData.entries());

                payload.customerName = String(payload.customerName || "").trim();
                payload.customerEmail = String(payload.customerEmail || "").trim();
                payload.orderNumber = String(payload.orderNumber || "").trim();
                payload.reason = String(payload.reason || "").trim();

                payload.locale = currentLanguage;
                payload.legalCopyVersion = 'v1';

                if (!payload.customerName) {
                    status.style.color = 'red';
                    status.textContent = t("requiredName");
                    submitBtn.disabled = false;
                    return;
                }

                if (!payload.customerEmail || !payload.customerEmail.includes("@")) {
                    status.style.color = 'red';
                    status.textContent = t("invalidEmail");
                    submitBtn.disabled = false;
                    return;
                }

                if (!payload.orderNumber) {
                    status.style.color = 'red';
                    status.textContent = t("requiredOrderNumber");
                    submitBtn.disabled = false;
                    return;
                }

                try {
                    const response = await fetch("/apps/eu-withdrawal/withdrawal-request", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify(payload),
                    });

                    const data = await response.json();

                    if (!response.ok) {
                        // 🔥 THIS IS THE KEY FIX
                        status.style.color = 'red';
                        status.textContent = errorText(data.error);
                        return;
                    }

                    // ✅ SUCCESS
                    status.style.color = 'green';

                    if (data.duplicate) {
                        status.textContent = t("duplicate");
                    } else {
                        status.textContent =
                            `${t("success")} ${data.reference}`;
                    }

                    form.reset();

                    setTimeout(() => {
                        modal.style.display = 'none';
                    }, 2500);

                } catch (error) {
                    console.error("Withdrawal error:", error);

                    // 🔥 ONLY true network failures hit this
                    status.style.color = 'red';
                    status.textContent = t("connectionIssue");
                } finally {
                    submitBtn.disabled = false;
                }
            });
        }

        wrapper.appendChild(button);

        if (isFloating) {
            document.body.appendChild(wrapper);
        } else {
            root.appendChild(wrapper);
        }

        document.body.appendChild(modal);
    });
})();