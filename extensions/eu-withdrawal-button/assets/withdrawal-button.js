(function () {
  const roots = document.querySelectorAll('.eu-withdrawal-button-root');

  roots.forEach((root) => {
    const appUrl = root.dataset.appUrl;
    const shopDomain = root.dataset.shopDomain;
    const locale = root.dataset.locale || 'en';
    const buttonLabel = root.dataset.buttonLabel || 'Exercise your right to withdraw';
    const heading = root.dataset.heading || 'Exercise your right of withdrawal';

    const wrapper = document.createElement('div');
    wrapper.style.margin = '16px 0';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = buttonLabel;
    button.style.padding = '12px 18px';
    button.style.borderRadius = '999px';
    button.style.border = '1px solid #111';
    button.style.background = '#111';
    button.style.color = '#fff';
    button.style.cursor = 'pointer';

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
      supportEmail: null
    };

    async function loadSettings() {
      try {
        const res = await fetch(`${appUrl}/public/settings?shop=${shopDomain}`);
        const data = await res.json();
        settings = { ...settings, ...data };
      } catch (e) {
        console.error("Settings fetch failed", e);
      }
    }

    function buildComplianceHtml() {
      let html = `
        <p style="margin:0;">
          By submitting this form, you are exercising your right to withdraw from your purchase under applicable consumer protection laws.
        </p>
        <p style="margin:6px 0 0;">
          Withdrawal requests must typically be submitted within ${settings.withdrawalDays} days of receiving your order.
        </p>
      `;

      if (settings.legalPageUrl || settings.privacyPageUrl) {
        html += `<p style="margin:6px 0 0;">`;

        if (settings.legalPageUrl) {
          html += `<a href="${settings.legalPageUrl}" target="_blank">Terms</a>`;
        }

        if (settings.legalPageUrl && settings.privacyPageUrl) {
          html += ` · `;
        }

        if (settings.privacyPageUrl) {
          html += `<a href="${settings.privacyPageUrl}" target="_blank">Privacy Policy</a>`;
        }

        html += `</p>`;
      } else {
        html += `
          <p style="margin:6px 0 0;">
            Please refer to the merchant’s website for full terms and conditions.
          </p>
        `;
      }

      if (settings.supportEmail) {
        html += `
          <p style="margin:6px 0 0;">
            Contact: <a href="mailto:${settings.supportEmail}">${settings.supportEmail}</a>
          </p>
        `;
      }

      return html;
    }

    function buildModal() {
      modal.innerHTML = `
        <div style="max-width:520px;margin:8vh auto;background:#fff;border-radius:16px;padding:24px;font-family:Arial,sans-serif;">
          
          <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;">
            <h3 style="margin:0;">${heading}</h3>
            <button type="button" data-close style="border:0;background:transparent;font-size:24px;cursor:pointer;">×</button>
          </div>

          <form data-form style="margin-top:20px;display:grid;gap:12px;">
            
            <input name="customerName" placeholder="Name" style="padding:12px;border:1px solid #ccc;border-radius:10px;" />
            
            <input name="customerEmail" placeholder="Email" required type="email" style="padding:12px;border:1px solid #ccc;border-radius:10px;" />
            
            <input name="orderNumber" placeholder="Order number" style="padding:12px;border:1px solid #ccc;border-radius:10px;" />
            
            <textarea name="reason" placeholder="Reason (optional)" rows="4" style="padding:12px;border:1px solid #ccc;border-radius:10px;"></textarea>

            <div style="font-size:12px; color:#666; line-height:1.5;">
              ${buildComplianceHtml()}
            </div>

            <button type="submit" style="padding:12px 18px;border-radius:999px;border:0;background:#111;color:#fff;cursor:pointer;">
              Submit request
            </button>

            <p data-status style="margin:0;font-size:14px;min-height:18px;"></p>
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

      modal.querySelector('[data-form]').addEventListener('submit', async (event) => {
        event.preventDefault();

        const form = event.currentTarget;
        const status = modal.querySelector('[data-status]');
        const submitBtn = form.querySelector('button[type="submit"]');

        submitBtn.disabled = true;
        status.style.color = '#666';
        status.textContent = 'Submitting...';

        const formData = new FormData(form);
        const payload = Object.fromEntries(formData.entries());

        payload.shopDomain = shopDomain;
        payload.locale = locale;
        payload.legalCopyVersion = 'v1';

        if (!payload.customerEmail.includes("@")) {
          status.style.color = 'red';
          status.textContent = "Please enter a valid email";
          submitBtn.disabled = false;
          return;
        }

        try {
          const response = await fetch(`${appUrl}/public/withdrawal-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          const data = await response.json();

          if (!response.ok) {
            // 🔥 THIS IS THE KEY FIX
            status.style.color = 'red';
            status.textContent = data.error || "Something went wrong";
            return;
          }

          // ✅ SUCCESS
          status.style.color = 'green';
          status.textContent = `Request submitted. Reference: ${data.reference}`;
          form.reset();

          setTimeout(() => {
            modal.style.display = 'none';
          }, 2500);

        } catch (error) {
          console.error("Withdrawal error:", error);

          // 🔥 ONLY true network failures hit this
          status.style.color = 'red';
          status.textContent = "Connection issue. Please try again.";
        } finally {
          submitBtn.disabled = false;
        }
      });
    }

    wrapper.appendChild(button);
    root.appendChild(wrapper);
    document.body.appendChild(modal);
  });
})();