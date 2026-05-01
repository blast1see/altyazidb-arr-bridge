# AltyaziDB Arr Bridge

**TR:** AltyaziDB film, dizi, anime, sezon ve bölüm altyazı sayfalarını yerel Radarr, Sonarr ve isteğe bağlı Prowlarr kurulumlarınla bağlayan tarayıcı eklentisi ve Tampermonkey scripti.

**EN:** A browser extension and Tampermonkey userscript that connects AltyaziDB subtitle pages for movies, series, anime, seasons, and episodes to local Radarr, Sonarr, and optional Prowlarr instances.

## Türkçe

### Özellikler

- Film sayfalarında Radarr butonu gösterir.
- Dizi, anime, sezon ve bölüm sayfalarında Sonarr butonu gösterir.
- İsteğe bağlı Prowlarr arama butonu gösterebilir.
- Sayfa türü net algılanamazsa Radarr ve Sonarr seçeneklerini birlikte gösterir.
- AltyaziDB API kullanmaz; açık sayfanın DOM, metadata, JSON-LD, URL ve görünen içerik bilgisini okur.
- API anahtarı yoksa bile Radarr/Sonarr/Prowlarr arama sayfasını açabilir.
- API anahtarı varsa lookup, popup sonuçları, bağlantı testi, mevcut kayıt kontrolü ve isteğe bağlı auto-add yapabilir.
- Hiçbir veriyi bu projeye ait harici bir sunucuya göndermez.

### Proje Yapısı

```text
altyazidb-arr-bridge-chrome-0.1.1/   Chrome / Chromium / Zen / Brave / Edge eklenti kaynağı
altyazidb-arr-bridge-firefox-0.1.1/  Firefox eklenti kaynağı
tampermonkey/                        Tampermonkey userscript kaynağı
scripts/package.ps1                  Zip / XPI / release arşivi oluşturma scripti
OPTIMIZATIONS.md                     Optimizasyon denetimi
README.md                            Türkçe + English dokümantasyon
```

Zip, XPI ve `release/` çıktıları GitHub kaynak takibine alınmaz. Paket üretmek için `scripts/package.ps1` kullanılabilir.

### Varsayılan Yerel Adresler

- Radarr: `http://localhost:7878`
- Sonarr: `http://localhost:8989`
- Prowlarr: `http://localhost:9696`

### API Anahtarı Ne İşe Yarıyor?

API anahtarı zorunlu değildir.

API anahtarı olmadan:

- Butonlar yine görünür.
- Radarr/Sonarr/Prowlarr arama sayfası en iyi arama terimiyle açılır.
- Örneğin Radarr `/add/new?term=...` sayfasına gider.

API anahtarıyla:

- Radarr/Sonarr/Prowlarr API lookup endpointleri kullanılabilir.
- IMDb, TMDb ve TVDb ID bilgileriyle daha doğru eşleşme yapılır.
- Film veya dizi zaten varsa mevcut Radarr/Sonarr sayfası açılabilir.
- Popup sonuç modu AltyaziDB sayfasında sonuç gösterebilir.
- Ayarlar sayfasındaki bağlantı testleri çalışır.
- Auto-add açıkça etkinleştirilirse ve root folder / quality profile ayarlanırsa film veya dizi eklenebilir.

Auto-add varsayılan olarak kapalıdır ve açıldığında indirme araması başlatmaz:

- Radarr: `searchForMovie: false`
- Sonarr: `searchForMissingEpisodes: false`
- Sonarr: `searchForCutoffUnmetEpisodes: false`

API anahtarları sadece yerel tarayıcı depolamasında saklanır ve yalnızca ayarladığın Arr adresine `X-Api-Key` header'ı olarak gönderilir.

### API Anahtarları Nereden Alınır?

Radarr, Sonarr ve Prowlarr için:

1. İlgili uygulamayı aç: `http://localhost:7878`, `http://localhost:8989` veya `http://localhost:9696`.
2. `Settings` bölümüne gir.
3. `General` sayfasını aç.
4. `Security` bölümünde `API Key` alanını bul.
5. API key değerini kopyalayıp eklenti veya Tampermonkey ayarlarına yapıştır.

### Arama Davranışı

Radarr:

- Önce film TMDb ID ile `tmdb:...`
- TMDb yoksa IMDb ID ile `imdb:...`
- ID yoksa isim/yıl

Sonarr:

- Önce TVDb ID ile `tvdb:...`
- TVDb yoksa TV TMDb ID ile `tmdb:...`
- ID yoksa isim/yıl

Prowlarr:

- Prowlarr release araması olduğu için isim tabanlı arama yapar.
- AltyaziDB sayfasında Türkçe/yerel başlık varsa, sadece Prowlarr için altyazı sürüm dosya adından İngilizce/uluslararası ad çıkarılır.
- Örneğin `Çıkış 8` sayfasında `Exit.8.2025...` sürüm satırı varsa Prowlarr araması `Exit 8 2025` olur.
- Prowlarr üzerinden otomatik grab/download yapılmaz.

### Chrome / Chromium / Zen Kurulumu

1. `chrome://extensions` adresini aç.
2. `Developer mode` seçeneğini aç.
3. `Load unpacked` butonuna bas.
4. `altyazidb-arr-bridge-chrome-0.1.1` klasörünü seç.
5. Eklenti detaylarından `Extension options` sayfasını aç.
6. URL ve API ayarlarını kontrol et.

### Firefox Kurulumu

1. `about:debugging#/runtime/this-firefox` adresini aç.
2. `This Firefox` bölümüne gir.
3. `Load Temporary Add-on` seç.
4. `altyazidb-arr-bridge-firefox-0.1.1/manifest.json` dosyasını seç.

Not: İmzasız yerel XPI dosyaları normal Firefox'ta kalıcı kurulum için Mozilla imzası isteyebilir. Test için `about:debugging` en sorunsuz yoldur.

### Tampermonkey Kurulumu

1. Tampermonkey Dashboard'u aç.
2. `Create a new script` seç.
3. Varsayılan şablonu sil.
4. `tampermonkey/altyazidb-arr-bridge.user.js` içeriğini yapıştır.
5. Kaydet.
6. Bir AltyaziDB film veya dizi sayfası aç.
7. Tampermonkey menüsünden `AltyaziDB Arr Bridge settings` ayarlarını aç.

Tampermonkey scripti varsayılan olarak yalnızca `localhost` ve `127.0.0.1` bağlantısına izin verir. Arr servislerin farklı hostta çalışıyorsa userscript metadata bölümüne uygun `@connect` satırı ekle.

### Paket Oluşturma

PowerShell ile:

```powershell
.\scripts\package.ps1
```

Bu komut şunları üretir:

- `altyazidb-arr-bridge-chrome-0.1.1.zip`
- `altyazidb-arr-bridge-firefox-0.1.1.zip`
- `altyazidb-arr-bridge-firefox-0.1.1.xpi`
- `release/altyazidb-arr-bridge-complete-0.1.1.zip`

### Test

1. Eklentiyi veya Tampermonkey scriptini kur.
2. Film sayfası aç: `https://altyazidb.com/film/724-michael.html`
3. Radarr butonunun göründüğünü kontrol et.
4. Dizi sayfası aç: `https://altyazidb.com/dizi/186-the-boys.html`
5. Sonarr butonunun göründüğünü kontrol et.
6. Prowlarr açıksa Prowlarr butonunu kontrol et.
7. API key girip bağlantı testlerini çalıştır.
8. Popup sonuç modunu dene.
9. Auto-add deneyeceksen önce root folder ve quality profile seç.

### Gizlilik

- Analytics yok.
- Telemetry yok.
- AltyaziDB API isteği yok.
- Bu proje harici bir sunucuya veri göndermez.
- İstekler yalnızca senin ayarladığın Radarr/Sonarr/Prowlarr adreslerine gider.

### Lisans

MIT. Ayrıntılar için `LICENSE` dosyasına bak.

## English

### Features

- Shows a Radarr button on movie pages.
- Shows a Sonarr button on series, anime, season, and episode pages.
- Can show an optional Prowlarr search button.
- Shows Radarr and Sonarr choices when the media type cannot be detected reliably.
- Does not use an AltyaziDB API; it reads only the current page DOM, metadata, JSON-LD, URL, and visible content.
- Works without API keys by opening the best local Arr search page.
- With API keys, it can perform lookups, popup results, connection tests, existing-item checks, and optional auto-add.
- Does not send data to any external server owned by this project.

### Repository Structure

```text
altyazidb-arr-bridge-chrome-0.1.1/   Chrome / Chromium / Zen / Brave / Edge extension source
altyazidb-arr-bridge-firefox-0.1.1/  Firefox extension source
tampermonkey/                        Tampermonkey userscript source
scripts/package.ps1                  Zip / XPI / release archive packaging script
OPTIMIZATIONS.md                     Optimization audit
README.md                            Turkish + English documentation
```

Zip, XPI, and `release/` outputs are ignored by git. Use `scripts/package.ps1` to generate packages.

### Default Local URLs

- Radarr: `http://localhost:7878`
- Sonarr: `http://localhost:8989`
- Prowlarr: `http://localhost:9696`

### What API Keys Do

API keys are optional.

Without API keys:

- Buttons still work.
- Radarr/Sonarr/Prowlarr open in the browser with the best search term.
- For example, Radarr can open `/add/new?term=...`.

With API keys:

- The extension can call Radarr/Sonarr/Prowlarr lookup endpoints directly.
- IMDb, TMDb, and TVDb IDs can be used for more accurate matching.
- Existing local movies or series can open directly in Radarr/Sonarr.
- Popup result mode can display results directly on AltyaziDB.
- Connection test buttons work.
- Auto-add can add a movie or series only when explicitly enabled and root folder / quality profile settings are configured.

Auto-add is disabled by default and does not start an immediate download search:

- Radarr: `searchForMovie: false`
- Sonarr: `searchForMissingEpisodes: false`
- Sonarr: `searchForCutoffUnmetEpisodes: false`

API keys are stored only in local browser storage and are sent only as `X-Api-Key` to your configured Arr URL.

### Getting API Keys

For Radarr, Sonarr, and Prowlarr:

1. Open the app: `http://localhost:7878`, `http://localhost:8989`, or `http://localhost:9696`.
2. Go to `Settings`.
3. Open `General`.
4. Find `API Key` in the `Security` section.
5. Copy it into the extension or Tampermonkey settings.

### Search Behavior

Radarr:

- First movie TMDb ID as `tmdb:...`
- Then IMDb ID as `imdb:...`
- Then title/year

Sonarr:

- First TVDb ID as `tvdb:...`
- Then TV TMDb ID as `tmdb:...`
- Then title/year

Prowlarr:

- Prowlarr uses name-based release searches.
- If AltyaziDB shows a translated/local title, subtitle release filenames are used only for Prowlarr to derive an English/international title.
- For example, `Çıkış 8` with an `Exit.8.2025...` release row searches Prowlarr as `Exit 8 2025`.
- The extension never grabs/downloads releases from Prowlarr automatically.

### Chrome / Chromium / Zen Installation

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select `altyazidb-arr-bridge-chrome-0.1.1`.
5. Open the extension details and then `Extension options`.
6. Confirm or edit URLs and API settings.

### Firefox Installation

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `This Firefox`.
3. Click `Load Temporary Add-on`.
4. Select `altyazidb-arr-bridge-firefox-0.1.1/manifest.json`.

Note: Unsigned local XPI files may require Mozilla signing for permanent installation in regular Firefox. `about:debugging` is the easiest local test path.

### Tampermonkey Installation

1. Open the Tampermonkey Dashboard.
2. Choose `Create a new script`.
3. Delete the template.
4. Paste the contents of `tampermonkey/altyazidb-arr-bridge.user.js`.
5. Save.
6. Open an AltyaziDB movie or series page.
7. Open the Tampermonkey menu and choose `AltyaziDB Arr Bridge settings`.

The userscript allows only `localhost` and `127.0.0.1` by default. Add a matching `@connect` metadata entry if your Arr services run on another host.

### Packaging

Run from PowerShell:

```powershell
.\scripts\package.ps1
```

This creates:

- `altyazidb-arr-bridge-chrome-0.1.1.zip`
- `altyazidb-arr-bridge-firefox-0.1.1.zip`
- `altyazidb-arr-bridge-firefox-0.1.1.xpi`
- `release/altyazidb-arr-bridge-complete-0.1.1.zip`

### Testing

1. Load the extension or Tampermonkey script.
2. Open a movie page: `https://altyazidb.com/film/724-michael.html`
3. Confirm the Radarr button appears.
4. Open a series page: `https://altyazidb.com/dizi/186-the-boys.html`
5. Confirm the Sonarr button appears.
6. Confirm the Prowlarr button appears when enabled.
7. Add API keys and run connection tests.
8. Try popup result mode.
9. Configure root folder and quality profile before testing auto-add.

### Privacy

- No analytics.
- No telemetry.
- No AltyaziDB API calls.
- No data is sent to an external server owned by this project.
- Requests go only to your configured Radarr/Sonarr/Prowlarr URLs.

### License

MIT. See `LICENSE` for details.
