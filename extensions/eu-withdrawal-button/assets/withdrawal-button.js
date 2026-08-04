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
    const buttonLabel = root.dataset.buttonLabel || 'Exercise your right to withdraw';
    const heading = root.dataset.heading || 'Exercise your right of withdrawal';
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
    button.textContent = buttonLabel;
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

    const TRANSLATIONS = {
      en: {
        languageName: "English",
        heading: "Submit Withdrawal Request",
        name: "Name",
        email: "Email address",
        orderNumber: "Order number",
        reason: "Reason (optional)",
        submit: "Submit request",
        submitting: "Submitting...",
        success: "Request submitted. Reference:",
        invalidEmail: "Please enter a valid email address.",
        requiredName: "Please enter your name.",
        requiredOrderNumber: "Please enter your order number.",
        connectionIssue: "Connection issue. Please try again.",
        withdrawalNotice:
            "Withdrawal requests must typically be submitted within {days} days of receiving your order.",
        fallbackTerms:
            "Please refer to the merchant’s website for the full terms and conditions.",
        terms: "Terms",
        privacy: "Privacy Policy",
        contact: "Contact",
      },

      de: {
        languageName: "Deutsch",
        heading: "Widerrufsantrag einreichen",
        name: "Name",
        email: "E-Mail-Adresse",
        orderNumber: "Bestellnummer",
        reason: "Grund (optional)",
        submit: "Antrag absenden",
        submitting: "Wird gesendet...",
        success: "Antrag eingereicht. Referenz:",
        invalidEmail: "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
        requiredName: "Bitte geben Sie Ihren Namen ein.",
        requiredOrderNumber: "Bitte geben Sie Ihre Bestellnummer ein.",
        connectionIssue:
            "Verbindungsproblem. Bitte versuchen Sie es erneut.",
        withdrawalNotice:
            "Widerrufsanträge müssen in der Regel innerhalb von {days} Tagen nach Erhalt Ihrer Bestellung eingereicht werden.",
        fallbackTerms:
            "Die vollständigen Bedingungen finden Sie auf der Website des Händlers.",
        terms: "Bedingungen",
        privacy: "Datenschutzerklärung",
        contact: "Kontakt",
      },

      fr: {
        languageName: "Français",
        heading: "Soumettre une demande de rétractation",
        name: "Nom",
        email: "Adresse e-mail",
        orderNumber: "Numéro de commande",
        reason: "Motif (facultatif)",
        submit: "Envoyer la demande",
        submitting: "Envoi en cours...",
        success: "Demande envoyée. Référence :",
        invalidEmail: "Veuillez saisir une adresse e-mail valide.",
        requiredName: "Veuillez saisir votre nom.",
        requiredOrderNumber: "Veuillez saisir votre numéro de commande.",
        connectionIssue:
            "Problème de connexion. Veuillez réessayer.",
        withdrawalNotice:
            "Les demandes de rétractation doivent généralement être envoyées dans un délai de {days} jours suivant la réception de votre commande.",
        fallbackTerms:
            "Veuillez consulter le site du marchand pour connaître l’intégralité des conditions générales.",
        terms: "Conditions",
        privacy: "Politique de confidentialité",
        contact: "Contact",
      },

      it: {
        languageName: "Italiano",
        heading: "Invia una richiesta di recesso",
        name: "Nome",
        email: "Indirizzo email",
        orderNumber: "Numero dell’ordine",
        reason: "Motivo (facoltativo)",
        submit: "Invia richiesta",
        submitting: "Invio in corso...",
        success: "Richiesta inviata. Riferimento:",
        invalidEmail: "Inserisci un indirizzo email valido.",
        requiredName: "Inserisci il tuo nome.",
        requiredOrderNumber: "Inserisci il numero dell’ordine.",
        connectionIssue:
            "Problema di connessione. Riprova.",
        withdrawalNotice:
            "Le richieste di recesso devono generalmente essere inviate entro {days} giorni dalla ricezione dell’ordine.",
        fallbackTerms:
            "Consulta il sito del venditore per leggere tutti i termini e le condizioni.",
        terms: "Termini",
        privacy: "Informativa sulla privacy",
        contact: "Contatto",
      },

      es: {
        languageName: "Español",
        heading: "Enviar solicitud de desistimiento",
        name: "Nombre",
        email: "Correo electrónico",
        orderNumber: "Número de pedido",
        reason: "Motivo (opcional)",
        submit: "Enviar solicitud",
        submitting: "Enviando...",
        success: "Solicitud enviada. Referencia:",
        invalidEmail:
            "Introduce una dirección de correo electrónico válida.",
        requiredName: "Introduce tu nombre.",
        requiredOrderNumber: "Introduce el número de pedido.",
        connectionIssue:
            "Problema de conexión. Inténtalo de nuevo.",
        withdrawalNotice:
            "Las solicitudes de desistimiento normalmente deben enviarse en un plazo de {days} días desde la recepción del pedido.",
        fallbackTerms:
            "Consulta el sitio web del comercio para ver los términos y condiciones completos.",
        terms: "Términos",
        privacy: "Política de privacidad",
        contact: "Contacto",
      },

      pt: {
        languageName: "Português",
        heading: "Enviar pedido de livre resolução",
        name: "Nome",
        email: "Endereço de email",
        orderNumber: "Número da encomenda",
        reason: "Motivo (opcional)",
        submit: "Enviar pedido",
        submitting: "A enviar...",
        success: "Pedido enviado. Referência:",
        invalidEmail: "Introduza um endereço de email válido.",
        requiredName: "Introduza o seu nome.",
        requiredOrderNumber: "Introduza o número da encomenda.",
        connectionIssue:
            "Problema de ligação. Tente novamente.",
        withdrawalNotice:
            "Os pedidos de livre resolução devem normalmente ser apresentados no prazo de {days} dias após a receção da encomenda.",
        fallbackTerms:
            "Consulte o site do comerciante para conhecer todos os termos e condições.",
        terms: "Termos",
        privacy: "Política de privacidade",
        contact: "Contacto",
      },

      nl: {
        languageName: "Nederlands",
        heading: "Herroepingsverzoek indienen",
        name: "Naam",
        email: "E-mailadres",
        orderNumber: "Bestelnummer",
        reason: "Reden (optioneel)",
        submit: "Verzoek indienen",
        submitting: "Bezig met verzenden...",
        success: "Verzoek ingediend. Referentie:",
        invalidEmail: "Voer een geldig e-mailadres in.",
        requiredName: "Vul uw naam in.",
        requiredOrderNumber: "Vul uw bestelnummer in.",
        connectionIssue:
            "Verbindingsprobleem. Probeer het opnieuw.",
        withdrawalNotice:
            "Herroepingsverzoeken moeten doorgaans binnen {days} dagen na ontvangst van uw bestelling worden ingediend.",
        fallbackTerms:
            "Raadpleeg de website van de handelaar voor de volledige algemene voorwaarden.",
        terms: "Voorwaarden",
        privacy: "Privacybeleid",
        contact: "Contact",
      },

      pl: {
        languageName: "Polski",
        heading: "Złóż oświadczenie o odstąpieniu",
        name: "Imię i nazwisko",
        email: "Adres e-mail",
        orderNumber: "Numer zamówienia",
        reason: "Powód (opcjonalnie)",
        submit: "Wyślij zgłoszenie",
        submitting: "Wysyłanie...",
        success: "Zgłoszenie zostało wysłane. Numer referencyjny:",
        invalidEmail: "Wprowadź prawidłowy adres e-mail.",
        requiredName: "Wprowadź imię i nazwisko.",
        requiredOrderNumber: "Wprowadź numer zamówienia.",
        connectionIssue:
            "Problem z połączeniem. Spróbuj ponownie.",
        withdrawalNotice:
            "Oświadczenie o odstąpieniu należy zazwyczaj złożyć w ciągu {days} dni od otrzymania zamówienia.",
        fallbackTerms:
            "Pełne warunki można znaleźć na stronie internetowej sprzedawcy.",
        terms: "Warunki",
        privacy: "Polityka prywatności",
        contact: "Kontakt",
      },

      da: {
        languageName: "Dansk",
        heading: "Indsend anmodning om fortrydelse",
        name: "Navn",
        email: "E-mailadresse",
        orderNumber: "Ordrenummer",
        reason: "Årsag (valgfrit)",
        submit: "Indsend anmodning",
        submitting: "Sender...",
        success: "Anmodningen er indsendt. Reference:",
        invalidEmail: "Indtast en gyldig e-mailadresse.",
        requiredName: "Indtast dit navn.",
        requiredOrderNumber: "Indtast dit ordrenummer.",
        connectionIssue:
            "Forbindelsesproblem. Prøv igen.",
        withdrawalNotice:
            "Anmodninger om fortrydelse skal normalt indsendes inden for {days} dage efter modtagelsen af din ordre.",
        fallbackTerms:
            "Se forhandlerens hjemmeside for de fulde vilkår og betingelser.",
        terms: "Vilkår",
        privacy: "Privatlivspolitik",
        contact: "Kontakt",
      },

      sv: {
        languageName: "Svenska",
        heading: "Skicka in begäran om ångerrätt",
        name: "Namn",
        email: "E-postadress",
        orderNumber: "Ordernummer",
        reason: "Anledning (valfritt)",
        submit: "Skicka begäran",
        submitting: "Skickar...",
        success: "Begäran har skickats. Referens:",
        invalidEmail: "Ange en giltig e-postadress.",
        requiredName: "Ange ditt namn.",
        requiredOrderNumber: "Ange ditt ordernummer.",
        connectionIssue:
            "Anslutningsproblem. Försök igen.",
        withdrawalNotice:
            "En begäran om att utnyttja ångerrätten ska normalt lämnas in inom {days} dagar efter att du mottagit beställningen.",
        fallbackTerms:
            "Se handlarens webbplats för fullständiga villkor.",
        terms: "Villkor",
        privacy: "Integritetspolicy",
        contact: "Kontakt",
      },

      fi: {
        languageName: "Suomi",
        heading: "Lähetä peruuttamispyyntö",
        name: "Nimi",
        email: "Sähköpostiosoite",
        orderNumber: "Tilausnumero",
        reason: "Syy (valinnainen)",
        submit: "Lähetä pyyntö",
        submitting: "Lähetetään...",
        success: "Pyyntö lähetetty. Viite:",
        invalidEmail: "Anna kelvollinen sähköpostiosoite.",
        requiredName: "Anna nimesi.",
        requiredOrderNumber: "Anna tilausnumerosi.",
        connectionIssue:
            "Yhteysongelma. Yritä uudelleen.",
        withdrawalNotice:
            "Peruuttamispyyntö on yleensä tehtävä {days} päivän kuluessa tilauksen vastaanottamisesta.",
        fallbackTerms:
            "Täydelliset ehdot löytyvät kauppiaan verkkosivustolta.",
        terms: "Ehdot",
        privacy: "Tietosuojakäytäntö",
        contact: "Yhteystiedot",
      },

      cs: {
        languageName: "Čeština",
        heading: "Odeslat žádost o odstoupení",
        name: "Jméno",
        email: "E-mailová adresa",
        orderNumber: "Číslo objednávky",
        reason: "Důvod (nepovinné)",
        submit: "Odeslat žádost",
        submitting: "Odesílání...",
        success: "Žádost byla odeslána. Referenční číslo:",
        invalidEmail: "Zadejte platnou e-mailovou adresu.",
        requiredName: "Zadejte své jméno.",
        requiredOrderNumber: "Zadejte číslo objednávky.",
        connectionIssue:
            "Problém s připojením. Zkuste to znovu.",
        withdrawalNotice:
            "Žádost o odstoupení je obvykle nutné podat do {days} dnů od převzetí objednávky.",
        fallbackTerms:
            "Úplné obchodní podmínky naleznete na webových stránkách obchodníka.",
        terms: "Podmínky",
        privacy: "Zásady ochrany osobních údajů",
        contact: "Kontakt",
      },

      sk: {
        languageName: "Slovenčina",
        heading: "Odoslať žiadosť o odstúpenie",
        name: "Meno",
        email: "E-mailová adresa",
        orderNumber: "Číslo objednávky",
        reason: "Dôvod (nepovinné)",
        submit: "Odoslať žiadosť",
        submitting: "Odosielanie...",
        success: "Žiadosť bola odoslaná. Referenčné číslo:",
        invalidEmail: "Zadajte platnú e-mailovú adresu.",
        requiredName: "Zadajte svoje meno.",
        requiredOrderNumber: "Zadajte číslo objednávky.",
        connectionIssue:
            "Problém s pripojením. Skúste to znova.",
        withdrawalNotice:
            "Žiadosť o odstúpenie je zvyčajne potrebné podať do {days} dní od prevzatia objednávky.",
        fallbackTerms:
            "Úplné obchodné podmienky nájdete na webovej stránke obchodníka.",
        terms: "Podmienky",
        privacy: "Zásady ochrany osobných údajov",
        contact: "Kontakt",
      },

      sl: {
        languageName: "Slovenščina",
        heading: "Pošljite zahtevo za odstop",
        name: "Ime",
        email: "E-poštni naslov",
        orderNumber: "Številka naročila",
        reason: "Razlog (neobvezno)",
        submit: "Pošlji zahtevo",
        submitting: "Pošiljanje...",
        success: "Zahteva je bila poslana. Referenca:",
        invalidEmail: "Vnesite veljaven e-poštni naslov.",
        requiredName: "Vnesite svoje ime.",
        requiredOrderNumber: "Vnesite številko naročila.",
        connectionIssue:
            "Težava s povezavo. Poskusite znova.",
        withdrawalNotice:
            "Zahtevo za odstop je običajno treba poslati v {days} dneh po prejemu naročila.",
        fallbackTerms:
            "Celotne pogoje najdete na spletnem mestu trgovca.",
        terms: "Pogoji",
        privacy: "Pravilnik o zasebnosti",
        contact: "Kontakt",
      },

      hr: {
        languageName: "Hrvatski",
        heading: "Pošaljite zahtjev za odustajanje",
        name: "Ime i prezime",
        email: "Adresa e-pošte",
        orderNumber: "Broj narudžbe",
        reason: "Razlog (neobavezno)",
        submit: "Pošalji zahtjev",
        submitting: "Slanje...",
        success: "Zahtjev je poslan. Referenca:",
        invalidEmail: "Unesite valjanu adresu e-pošte.",
        requiredName: "Unesite svoje ime i prezime.",
        requiredOrderNumber: "Unesite broj narudžbe.",
        connectionIssue:
            "Problem s vezom. Pokušajte ponovno.",
        withdrawalNotice:
            "Zahtjev za odustajanje obično je potrebno poslati u roku od {days} dana od primitka narudžbe.",
        fallbackTerms:
            "Potpune uvjete pronađite na internetskoj stranici trgovca.",
        terms: "Uvjeti",
        privacy: "Pravila privatnosti",
        contact: "Kontakt",
      },

      hu: {
        languageName: "Magyar",
        heading: "Elállási kérelem benyújtása",
        name: "Név",
        email: "E-mail-cím",
        orderNumber: "Rendelésszám",
        reason: "Indoklás (nem kötelező)",
        submit: "Kérelem elküldése",
        submitting: "Küldés...",
        success: "A kérelem elküldve. Hivatkozási szám:",
        invalidEmail: "Adjon meg érvényes e-mail-címet.",
        requiredName: "Adja meg a nevét.",
        requiredOrderNumber: "Adja meg a rendelésszámot.",
        connectionIssue:
            "Kapcsolódási probléma. Próbálja újra.",
        withdrawalNotice:
            "Az elállási kérelmet általában a rendelés kézhezvételétől számított {days} napon belül kell benyújtani.",
        fallbackTerms:
            "A teljes szerződési feltételeket a kereskedő weboldalán találja.",
        terms: "Feltételek",
        privacy: "Adatvédelmi szabályzat",
        contact: "Kapcsolat",
      },

      ro: {
        languageName: "Română",
        heading: "Trimiteți cererea de retragere",
        name: "Nume",
        email: "Adresă de e-mail",
        orderNumber: "Numărul comenzii",
        reason: "Motiv (opțional)",
        submit: "Trimite cererea",
        submitting: "Se trimite...",
        success: "Cererea a fost trimisă. Referință:",
        invalidEmail: "Introduceți o adresă de e-mail validă.",
        requiredName: "Introduceți numele.",
        requiredOrderNumber: "Introduceți numărul comenzii.",
        connectionIssue:
            "Problemă de conexiune. Încercați din nou.",
        withdrawalNotice:
            "Cererile de retragere trebuie, de regulă, transmise în termen de {days} zile de la primirea comenzii.",
        fallbackTerms:
            "Consultați site-ul comerciantului pentru termenii și condițiile complete.",
        terms: "Termeni",
        privacy: "Politica de confidențialitate",
        contact: "Contact",
      },

      bg: {
        languageName: "Български",
        heading: "Подайте искане за отказ",
        name: "Име",
        email: "Имейл адрес",
        orderNumber: "Номер на поръчката",
        reason: "Причина (незадължително)",
        submit: "Изпрати искането",
        submitting: "Изпращане...",
        success: "Искането е изпратено. Референтен номер:",
        invalidEmail: "Въведете валиден имейл адрес.",
        requiredName: "Въведете името си.",
        requiredOrderNumber: "Въведете номера на поръчката.",
        connectionIssue:
            "Проблем с връзката. Опитайте отново.",
        withdrawalNotice:
            "Искането за отказ обикновено трябва да бъде подадено в срок от {days} дни след получаване на поръчката.",
        fallbackTerms:
            "Вижте уебсайта на търговеца за пълните общи условия.",
        terms: "Условия",
        privacy: "Политика за поверителност",
        contact: "Контакт",
      },

      el: {
        languageName: "Ελληνικά",
        heading: "Υποβολή αιτήματος υπαναχώρησης",
        name: "Ονοματεπώνυμο",
        email: "Διεύθυνση email",
        orderNumber: "Αριθμός παραγγελίας",
        reason: "Αιτιολογία (προαιρετικά)",
        submit: "Υποβολή αιτήματος",
        submitting: "Υποβολή...",
        success: "Το αίτημα υποβλήθηκε. Αριθμός αναφοράς:",
        invalidEmail: "Εισαγάγετε μια έγκυρη διεύθυνση email.",
        requiredName: "Εισαγάγετε το ονοματεπώνυμό σας.",
        requiredOrderNumber: "Εισαγάγετε τον αριθμό παραγγελίας.",
        connectionIssue:
            "Πρόβλημα σύνδεσης. Δοκιμάστε ξανά.",
        withdrawalNotice:
            "Τα αιτήματα υπαναχώρησης πρέπει συνήθως να υποβάλλονται εντός {days} ημερών από την παραλαβή της παραγγελίας.",
        fallbackTerms:
            "Ανατρέξτε στον ιστότοπο του εμπόρου για τους πλήρεις όρους και προϋποθέσεις.",
        terms: "Όροι",
        privacy: "Πολιτική απορρήτου",
        contact: "Επικοινωνία",
      },

      et: {
        languageName: "Eesti",
        heading: "Esita taganemistaotlus",
        name: "Nimi",
        email: "E-posti aadress",
        orderNumber: "Tellimuse number",
        reason: "Põhjus (valikuline)",
        submit: "Esita taotlus",
        submitting: "Saatmine...",
        success: "Taotlus on esitatud. Viide:",
        invalidEmail: "Sisestage kehtiv e-posti aadress.",
        requiredName: "Sisestage oma nimi.",
        requiredOrderNumber: "Sisestage tellimuse number.",
        connectionIssue:
            "Ühenduse probleem. Proovige uuesti.",
        withdrawalNotice:
            "Taganemistaotlus tuleb tavaliselt esitada {days} päeva jooksul pärast tellimuse kättesaamist.",
        fallbackTerms:
            "Täielikud tingimused leiate kaupmehe veebisaidilt.",
        terms: "Tingimused",
        privacy: "Privaatsuspoliitika",
        contact: "Kontakt",
      },

      lv: {
        languageName: "Latviešu",
        heading: "Iesniegt atteikuma pieprasījumu",
        name: "Vārds",
        email: "E-pasta adrese",
        orderNumber: "Pasūtījuma numurs",
        reason: "Iemesls (nav obligāts)",
        submit: "Iesniegt pieprasījumu",
        submitting: "Notiek nosūtīšana...",
        success: "Pieprasījums iesniegts. Atsauce:",
        invalidEmail: "Ievadiet derīgu e-pasta adresi.",
        requiredName: "Ievadiet savu vārdu.",
        requiredOrderNumber: "Ievadiet pasūtījuma numuru.",
        connectionIssue:
            "Savienojuma problēma. Mēģiniet vēlreiz.",
        withdrawalNotice:
            "Atteikuma pieprasījums parasti jāiesniedz {days} dienu laikā pēc pasūtījuma saņemšanas.",
        fallbackTerms:
            "Pilnus noteikumus un nosacījumus skatiet tirgotāja tīmekļa vietnē.",
        terms: "Noteikumi",
        privacy: "Privātuma politika",
        contact: "Kontaktinformācija",
      },

      lt: {
        languageName: "Lietuvių",
        heading: "Pateikti sutarties atsisakymo prašymą",
        name: "Vardas ir pavardė",
        email: "El. pašto adresas",
        orderNumber: "Užsakymo numeris",
        reason: "Priežastis (nebūtina)",
        submit: "Pateikti prašymą",
        submitting: "Siunčiama...",
        success: "Prašymas pateiktas. Nuorodos numeris:",
        invalidEmail: "Įveskite galiojantį el. pašto adresą.",
        requiredName: "Įveskite savo vardą ir pavardę.",
        requiredOrderNumber: "Įveskite užsakymo numerį.",
        connectionIssue:
            "Ryšio problema. Bandykite dar kartą.",
        withdrawalNotice:
            "Sutarties atsisakymo prašymas paprastai turi būti pateiktas per {days} dienų nuo užsakymo gavimo.",
        fallbackTerms:
            "Visas sąlygas rasite prekybininko svetainėje.",
        terms: "Sąlygos",
        privacy: "Privatumo politika",
        contact: "Kontaktai",
      },

      ga: {
        languageName: "Gaeilge",
        heading: "Cuir iarratas aistarraingthe isteach",
        name: "Ainm",
        email: "Seoladh ríomhphoist",
        orderNumber: "Uimhir ordaithe",
        reason: "Cúis (roghnach)",
        submit: "Cuir an t-iarratas isteach",
        submitting: "Á sheoladh...",
        success: "Cuireadh an t-iarratas isteach. Tagairt:",
        invalidEmail: "Cuir seoladh ríomhphoist bailí isteach.",
        requiredName: "Cuir d’ainm isteach.",
        requiredOrderNumber: "Cuir uimhir an ordaithe isteach.",
        connectionIssue:
            "Fadhb cheangail. Bain triail eile as.",
        withdrawalNotice:
            "De ghnáth, ní mór iarratais aistarraingthe a chur isteach laistigh de {days} lá tar éis d’ordú a fháil.",
        fallbackTerms:
            "Féach suíomh gréasáin an cheannaí le haghaidh na dtéarmaí agus na gcoinníollacha iomlána.",
        terms: "Téarmaí",
        privacy: "Beartas príobháideachais",
        contact: "Teagmháil",
      },

      mt: {
        languageName: "Malti",
        heading: "Ibgħat talba għall-irtirar",
        name: "Isem",
        email: "Indirizz elettroniku",
        orderNumber: "Numru tal-ordni",
        reason: "Raġuni (mhux obbligatorja)",
        submit: "Ibgħat it-talba",
        submitting: "Qed tintbagħat...",
        success: "It-talba ntbagħtet. Referenza:",
        invalidEmail: "Daħħal indirizz elettroniku validu.",
        requiredName: "Daħħal ismek.",
        requiredOrderNumber: "Daħħal in-numru tal-ordni.",
        connectionIssue:
            "Problema fil-konnessjoni. Erġa’ pprova.",
        withdrawalNotice:
            "It-talbiet għall-irtirar normalment għandhom jintbagħtu fi żmien {days} jum minn meta tirċievi l-ordni.",
        fallbackTerms:
            "Ara s-sit elettroniku tal-bejjiegħ għat-termini u l-kundizzjonijiet kollha.",
        terms: "Termini",
        privacy: "Politika tal-privatezza",
        contact: "Kuntatt",
      },
    };

    let currentLanguage = "en";

    function normaliseLanguage(code) {
      return String(code || "en").toLowerCase().split("-")[0];
    }

    function getEnabledLanguages() {
      const enabled = Array.isArray(settings.enabledLanguages)
          ? settings.enabledLanguages
          : ["en", "de"];

      return enabled.filter((code) => TRANSLATIONS[code]);
    }

    function t(key) {
      const lang = TRANSLATIONS[currentLanguage] || TRANSLATIONS.en;
      return lang[key] || TRANSLATIONS.en[key] || key;
    }

    function formatText(value) {
      return String(value || "").replace("{days}", settings.withdrawalDays || 14);
    }

    function buildLanguageOptionsHtml() {
      const enabled = getEnabledLanguages();

      if (enabled.length <= 1) {
        return "";
      }

      return `
    <select data-language-select style="
      padding:8px 10px;
      border:1px solid #d1d5db;
      border-radius:8px;
      background:#fff;
      font-size:14px;
      cursor:pointer;
    ">
      ${enabled.map((code) => {
        const label = TRANSLATIONS[code]?.languageName || code.toUpperCase();
        return `<option value="${code}" ${code === currentLanguage ? "selected" : ""}>${label}</option>`;
      }).join("")}
    </select>
  `;
    }

    async function loadSettings() {
      try {
        const settingsUrl = `${appUrl}/public/settings?shop=${shopDomain}`;
        console.log("EU Withdrawal settings URL:", settingsUrl);

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
      ${formatText(t("withdrawalNotice"))}
    </p>
  `;

      if (settings.legalPageUrl || settings.privacyPageUrl) {
        html += `<p style="margin:6px 0 0;">`;

        if (settings.legalPageUrl) {
          html += `<a href="${settings.legalPageUrl}" target="_blank">${t("terms")}</a>`;
        }

        if (settings.legalPageUrl && settings.privacyPageUrl) {
          html += ` · `;
        }

        if (settings.privacyPageUrl) {
          html += `<a href="${settings.privacyPageUrl}" target="_blank">${t("privacy")}</a>`;
        }

        html += `</p>`;
      }

      if (settings.supportEmail) {
        html += `
      <p style="margin:6px 0 0;">
        ${t("contact")}: <a href="mailto:${settings.supportEmail}">${settings.supportEmail}</a>
      </p>
    `;
      }

      return html;
    }

    function buildModal() {
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
        <h3 style="margin:0;">${t("heading")}</h3>

        <div style="
          display:flex;
          align-items:center;
          gap:8px;
        ">
          ${buildLanguageOptionsHtml()}

          <button
            type="button"
            data-close
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
          placeholder="${t("name")}"
          required
          autocomplete="name"
          style="padding:12px;border:1px solid #ccc;border-radius:10px;"
        />
        
        <input
          name="customerEmail"
          placeholder="${t("email")}"
          required
          type="email"
          style="padding:12px;border:1px solid #ccc;border-radius:10px;"
        />
        
        <input
          name="orderNumber"
          placeholder="${t("orderNumber")}"
          required
          autocomplete="off"
          style="padding:12px;border:1px solid #ccc;border-radius:10px;"
        />
        
        <textarea
          name="reason"
          placeholder="${t("reason")}"
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
          ${t("submit")}
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

      const languageSelect = modal.querySelector("[data-language-select]");

      if (languageSelect) {
        languageSelect.addEventListener("change", (event) => {
          currentLanguage = event.target.value;
          buildModal();
          attachModalEvents();
        });
      }

      modal.querySelector('[data-form]').addEventListener('submit', async (event) => {
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
            status.textContent = data.error || "Something went wrong";
            return;
          }

          // ✅ SUCCESS
          status.style.color = 'green';
          status.textContent = `${t("success")} ${data.reference}`;
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