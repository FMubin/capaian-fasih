/**
 * REKAP.JS - Portal Rekapitulasi & Cetak Organik BPS (Exact 2-Page Layout)
 */

document.addEventListener('DOMContentLoaded', () => {
  let kecamatanList = [];
  let currentItems = [];

  const filterKecamatan = document.getElementById('filterKecamatan');
  const filterSearch = document.getElementById('filterSearch');
  const btnClearSearch = document.getElementById('btnClearSearch');
  const btnRefreshList = document.getElementById('btnRefreshList');
  const btnPrintAll = document.getElementById('btnPrintAll');

  const mergedContainer = document.getElementById('mergedContainer');
  const emptyState = document.getElementById('emptyState');
  const printContainer = document.getElementById('printContainer');

  const modalLightbox = document.getElementById('modalLightbox');
  const lightboxImage = document.getElementById('lightboxImage');
  const lightboxTitle = document.getElementById('lightboxTitle');
  const lightboxTime = document.getElementById('lightboxTime');
  const btnDownloadImage = document.getElementById('btnDownloadImage');
  const btnCloseLightbox = document.getElementById('btnCloseLightbox');

  fetchMasterData();
  fetchCapaianList();

  async function fetchMasterData() {
    try {
      const res = await fetch('/api/master-data');
      const json = await res.json();
      if (json.success) {
        kecamatanList = json.kecamatan || [];
        populateKecamatanDropdown();
      }
    } catch (err) {
      console.error('Failed to fetch master data:', err);
    }
  }

  function populateKecamatanDropdown() {
    filterKecamatan.innerHTML = '<option value="SEMUA">Semua Kecamatan</option>';
    kecamatanList.forEach(kec => {
      const opt = document.createElement('option');
      opt.value = kec;
      opt.textContent = kec;
      filterKecamatan.appendChild(opt);
    });
  }

  async function fetchCapaianList() {
    const kec = filterKecamatan.value || 'SEMUA';
    const q = filterSearch.value.trim();

    const params = new URLSearchParams();
    if (kec !== 'SEMUA') params.append('kecamatan', kec);
    if (q) params.append('search', q);

    try {
      const res = await fetch(`/api/capaian?${params.toString()}`);
      const json = await res.json();

      if (json.success) {
        currentItems = json.data;
        renderMergedOfficersView(currentItems);
      }
    } catch (err) {
      console.error('Failed to fetch list:', err);
      showToast('Gagal mengambil data dari server', 'danger');
    }
  }

  function renderMergedOfficersView(items) {
    if (items.length === 0) {
      mergedContainer.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');

    const grouped = {};
    items.forEach(item => {
      const key = `${item.kecamatan}__${item.nama}`;
      if (!grouped[key]) {
        grouped[key] = {
          kecamatan: item.kecamatan,
          nama: item.nama,
          posisi: item.posisi || 'PPL Sensus',
          screenshots: []
        };
      }
      grouped[key].screenshots.push(item);
    });

    mergedContainer.innerHTML = Object.values(grouped).map(group => {
      const initial = group.nama.charAt(0).toUpperCase();

      return `
        <div class="officer-card">
          <div class="officer-card-header">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <div class="officer-avatar">${initial}</div>
              <div>
                <h3 style="font-size: 1.05rem; font-weight: 700; color: #1e293b;">${escapeHTML(group.nama)} <span style="font-size: 0.75rem; background: #e0f2fe; color: #0284c7; padding: 2px 6px; border-radius: 4px;">${group.posisi}</span></h3>
                <p style="font-size: 0.8rem; color: #64748b;"><i class="fa-solid fa-location-dot"></i> ${escapeHTML(group.kecamatan)} &bull; ${group.screenshots.length} Screenshot Unggahan</p>
              </div>
            </div>

            <div style="display: flex; gap: 0.5rem;">
              <button type="button" class="btn-print" onclick="printSingleOfficerReport('${escapeHTML(group.kecamatan)}', '${escapeHTML(group.nama)}')">
                <i class="fa-solid fa-print"></i> Cetak Lembar (Hal 1: Capaian & Hal 2: Hapus)
              </button>
              <button type="button" class="btn-print" style="background: #ef4444;" onclick="deleteAllOfficerScreenshots('${escapeHTML(group.kecamatan)}', '${escapeHTML(group.nama)}')">
                <i class="fa-solid fa-trash-can"></i> Hapus Semua
              </button>
            </div>
          </div>

          <div class="officer-gallery-grid">
            ${group.screenshots.map(s => {
              const isHapus = (s.jenis || '').includes('Hapus');
              const tagClass = isHapus ? 'hapus' : 'capaian';
              const tagText = isHapus ? 'Hapus FASIH / Periode' : 'Capaian Petugas';

              return `
                <div class="screenshot-item" onclick="openLightbox('${s.id}')">
                  <img src="${s.file_url}" alt="Screenshot" loading="lazy">
                  <span class="jenis-tag ${tagClass}">${tagText}</span>
                  <button type="button" class="item-delete-btn" onclick="event.stopPropagation(); deleteSingleScreenshot('${s.id}')" title="Hapus Gambar Ini">&times;</button>
                  <div style="position: absolute; bottom: 0; inset-x: 0; background: rgba(15,23,42,0.85); color: #fff; padding: 4px 6px; font-size: 0.72rem;">
                    ${formatDate(s.created_at)}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  // Filter Events
  filterKecamatan.addEventListener('change', fetchCapaianList);

  let searchTimeout;
  filterSearch.addEventListener('input', (e) => {
    if (e.target.value.trim() !== '') btnClearSearch.classList.remove('hidden');
    else btnClearSearch.classList.add('hidden');
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(fetchCapaianList, 300);
  });

  btnClearSearch.addEventListener('click', () => {
    filterSearch.value = '';
    btnClearSearch.classList.add('hidden');
    fetchCapaianList();
  });

  btnRefreshList.addEventListener('click', fetchCapaianList);

  // EXACT 2-PAGE PRINT REPORT SYSTEM (HALAMAN 1: CAPAIAN, HALAMAN 2: HAPUS)
  btnPrintAll.addEventListener('click', () => {
    if (currentItems.length === 0) {
      showToast('Tidak ada data screenshot untuk dicetak', 'danger');
      return;
    }
    buildAndTriggerPrint(currentItems);
  });

  window.printSingleOfficerReport = function(kecamatan, nama) {
    const officerItems = currentItems.filter(i => i.kecamatan.toLowerCase() === kecamatan.toLowerCase() && i.nama.toLowerCase() === nama.toLowerCase());
    if (officerItems.length === 0) return;
    buildAndTriggerPrint(officerItems);
  };

  function buildAndTriggerPrint(itemsToPrint) {
    const grouped = {};
    itemsToPrint.forEach(item => {
      const key = `${item.kecamatan}__${item.nama}`;
      if (!grouped[key]) {
        grouped[key] = {
          kecamatan: item.kecamatan,
          nama: item.nama,
          posisi: item.posisi || 'PPL Sensus',
          screenshots: []
        };
      }
      grouped[key].screenshots.push(item);
    });

    const nowStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    let printHTML = '';

    Object.values(grouped).forEach((group, index) => {
      // Separate screenshots into Capaian vs Hapus
      const capaianList = group.screenshots.filter(s => !(s.jenis || '').includes('Hapus'));
      const hapusList = group.screenshots.filter(s => (s.jenis || '').includes('Hapus'));

      // If officer has no explicit Capaian tag but has screenshots, consider them Capaian by default
      const finalCapaian = (capaianList.length === 0 && hapusList.length === 0) ? group.screenshots : capaianList;

      const isCapaianCompact = finalCapaian.length >= 4;
      const capaianGridClass = isCapaianCompact ? 'print-grid grid-compact' : 'print-grid';

      const isHapusCompact = hapusList.length >= 4;
      const hapusGridClass = isHapusCompact ? 'print-grid grid-compact' : 'print-grid';

      // ----------------------------------------------------
      // HALAMAN 1 PRINT: CAPAIAN PETUGAS
      // ----------------------------------------------------
      printHTML += `
        <div class="print-page-wrapper">
          <div class="print-header">
            <h2>BADAN PUSAT STATISTIK</h2>
            <p>HALAMAN 1: REKAPITULASI DOKUMENTASI CAPAIAN PETUGAS</p>
            <small>REKAP CAPAIAN FASIH - ${group.nama.toUpperCase()} (${group.kecamatan.toUpperCase()}) &bull; Tanggal Cetak: ${nowStr}</small>
          </div>

          <div class="print-officer-block">
            <div class="print-officer-info">
              <strong>NAMA PETUGAS:</strong> ${escapeHTML(group.nama)} (${group.posisi}) &nbsp;|&nbsp; 
              <strong>KECAMATAN TUGAS:</strong> ${escapeHTML(group.kecamatan)} &nbsp;|&nbsp; 
              <strong>JUMLAH SCREENSHOT CAPAIAN:</strong> ${finalCapaian.length} File Gambar
            </div>

            ${finalCapaian.length > 0 ? `
              <div class="${capaianGridClass}">
                ${finalCapaian.map(s => `
                  <div class="print-image-card">
                    <img src="${s.file_url}" alt="Screenshot Capaian">
                    <div class="print-image-caption">
                      [CAPAIAN PETUGAS] ${formatDate(s.created_at)}
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : `
              <div class="empty-print-notice">Tidak ada lampiran screenshot Capaian Petugas.</div>
            `}
          </div>
        </div>
      `;

      // ----------------------------------------------------
      // HALAMAN 2 PRINT: HAPUS APLIKASI FASIH / PERIODE SENSUS
      // ----------------------------------------------------
      printHTML += `
        <div class="print-page-wrapper print-page-break">
          <div class="print-header">
            <h2>BADAN PUSAT STATISTIK</h2>
            <p>HALAMAN 2: REKAPITULASI HAPUS APLIKASI FASIH / PERIODE SENSUS</p>
            <small>REKAP HAPUS FASIH - ${group.nama.toUpperCase()} (${group.kecamatan.toUpperCase()}) &bull; Tanggal Cetak: ${nowStr}</small>
          </div>

          <div class="print-officer-block">
            <div class="print-officer-info">
              <strong>NAMA PETUGAS:</strong> ${escapeHTML(group.nama)} (${group.posisi}) &nbsp;|&nbsp; 
              <strong>KECAMATAN TUGAS:</strong> ${escapeHTML(group.kecamatan)} &nbsp;|&nbsp; 
              <strong>JUMLAH SCREENSHOT HAPUS:</strong> ${hapusList.length} File Gambar
            </div>

            ${hapusList.length > 0 ? `
              <div class="${hapusGridClass}">
                ${hapusList.map(s => `
                  <div class="print-image-card">
                    <img src="${s.file_url}" alt="Screenshot Hapus">
                    <div class="print-image-caption">
                      [HAPUS FASIH / PERIODE] ${formatDate(s.created_at)}
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : `
              <div class="empty-print-notice">Tidak ada lampiran screenshot Hapus Aplikasi FASIH / Periode Sensus.</div>
            `}
          </div>
        </div>
      `;
    });

    printContainer.innerHTML = printHTML;

    setTimeout(() => {
      window.print();
    }, 200);
  }

  // Delete Handlers
  window.deleteSingleScreenshot = async function(id) {
    if (!confirm('Apakah Anda yakin ingin menghapus screenshot ini?')) return;

    try {
      const res = await fetch(`/api/capaian/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        showToast('Screenshot berhasil dihapus', 'success');
        fetchCapaianList();
      }
    } catch (err) {
      showToast('Gagal menghapus screenshot', 'danger');
    }
  };

  window.deleteAllOfficerScreenshots = async function(kecamatan, nama) {
    if (!confirm(`Apakah Anda yakin ingin menghapus SELURUH screenshot milik ${nama}?`)) return;

    try {
      const res = await fetch('/api/capaian-petugas', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kecamatan, nama })
      });
      const json = await res.json();
      if (json.success) {
        showToast(json.message, 'success');
        fetchCapaianList();
      }
    } catch (err) {
      showToast('Gagal menghapus data petugas', 'danger');
    }
  };

  // Lightbox
  window.openLightbox = function(id) {
    const item = currentItems.find(i => i.id === id);
    if (!item) return;

    lightboxImage.src = item.file_url;
    lightboxTitle.textContent = `${item.nama} (${item.posisi || 'PPL Sensus'}) - ${item.kecamatan}`;
    lightboxTime.textContent = `Waktu Upload: ${formatDate(item.created_at)}`;
    btnDownloadImage.href = item.file_url;
    btnDownloadImage.download = item.original_name || `Screenshot_${item.nama}.png`;

    modalLightbox.classList.remove('hidden');
  };

  btnCloseLightbox.addEventListener('click', () => modalLightbox.classList.add('hidden'));

  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let iconClass = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';
    toast.innerHTML = `<i class="fa-solid ${iconClass}"></i> <span>${escapeHTML(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function formatDate(isoStr) {
    if (!isoStr) return '-';
    const date = new Date(isoStr);
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
  }
});
