/**
 * REKAP.JS - Portal Rekapitulasi & Cetak Organik BPS (Exact 2-Page Layout)
 */

document.addEventListener('DOMContentLoaded', () => {
  let kecamatanList = [];
  let currentItems = [];
  let groupedOfficers = [];
  let currentPage = 1;
  const ITEMS_PER_PAGE = 10;

  const filterKecamatan = document.getElementById('filterKecamatan');
  const filterSearch = document.getElementById('filterSearch');
  const btnClearSearch = document.getElementById('btnClearSearch');
  const btnRefreshList = document.getElementById('btnRefreshList');
  const btnPrintAll = document.getElementById('btnPrintAll');

  const mergedContainer = document.getElementById('mergedContainer');
  const emptyState = document.getElementById('emptyState');
  const printContainer = document.getElementById('printContainer');

  const paginationBar = document.getElementById('paginationBar');
  const paginationInfo = document.getElementById('paginationInfo');
  const btnPrevPage = document.getElementById('btnPrevPage');
  const btnNextPage = document.getElementById('btnNextPage');
  const pageNumbers = document.getElementById('pageNumbers');

  const modalLightbox = document.getElementById('modalLightbox');
  const lightboxImage = document.getElementById('lightboxImage');
  const lightboxTitle = document.getElementById('lightboxTitle');
  const lightboxTime = document.getElementById('lightboxTime');
  const btnDownloadImage = document.getElementById('btnDownloadImage');
  const btnToggleMaintenance = document.getElementById('btnToggleMaintenance');
  const maintStatusText = document.getElementById('maintStatusText');
  let isMaintenanceActive = false;

  fetchMaintenanceStatus();
  fetchMasterData();
  fetchCapaianList();

  async function fetchMaintenanceStatus() {
    try {
      const res = await fetch('/api/maintenance');
      const json = await res.json();
      if (json.success) {
        isMaintenanceActive = Boolean(json.maintenance);
        updateMaintenanceUI();
      }
    } catch (err) {
      console.error('Failed to fetch maintenance status:', err);
    }
  }

  function updateMaintenanceUI() {
    if (!maintStatusText) return;
    if (isMaintenanceActive) {
      maintStatusText.textContent = 'AKTIF (ON)';
      maintStatusText.style.color = '#ef4444';
      if (btnToggleMaintenance) {
        btnToggleMaintenance.style.borderColor = '#ef4444';
        btnToggleMaintenance.style.background = '#fef2f2';
        btnToggleMaintenance.style.color = '#ef4444';
      }
    } else {
      maintStatusText.textContent = 'NONAKTIF (OFF)';
      maintStatusText.style.color = '#10b981';
      if (btnToggleMaintenance) {
        btnToggleMaintenance.style.borderColor = '#10b981';
        btnToggleMaintenance.style.background = '#f0fdf4';
        btnToggleMaintenance.style.color = '#047857';
      }
    }
  }

  if (btnToggleMaintenance) {
    btnToggleMaintenance.addEventListener('click', async () => {
      const nextState = !isMaintenanceActive;
      const confirmMsg = nextState 
        ? 'Apakah Anda yakin ingin MENGAKTIFKAN Mode Pemeliharaan (Maintenance)? Petugas tidak akan bisa mengunggah screenshot.' 
        : 'Apakah Anda yakin ingin MENONAKTIFKAN Mode Pemeliharaan (Maintenance)? Form upload petugas akan terbuka kembali.';
      
      if (!confirm(confirmMsg)) return;

      // Optimistic UI Update for instant 0ms visual feedback
      const previousState = isMaintenanceActive;
      isMaintenanceActive = nextState;
      updateMaintenanceUI();
      btnToggleMaintenance.disabled = true;

      try {
        const res = await fetch('/api/maintenance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: nextState })
        });
        const json = await res.json();
        if (json.success) {
          isMaintenanceActive = Boolean(json.maintenance);
          updateMaintenanceUI();
          showToast(json.message, 'success');
        } else {
          isMaintenanceActive = previousState;
          updateMaintenanceUI();
          showToast(json.message || 'Gagal mengubah mode maintenance', 'danger');
        }
      } catch (err) {
        isMaintenanceActive = previousState;
        updateMaintenanceUI();
        showToast('Gagal mengubah mode maintenance', 'danger');
      } finally {
        btnToggleMaintenance.disabled = false;
      }
    });
  }

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
        groupOfficersAndRender(currentItems);
      }
    } catch (err) {
      console.error('Failed to fetch list:', err);
      showToast('Gagal mengambil data dari server', 'danger');
    }
  }

  function groupOfficersAndRender(items) {
    if (items.length === 0) {
      groupedOfficers = [];
      mergedContainer.innerHTML = '';
      emptyState.classList.remove('hidden');
      if (paginationBar) paginationBar.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');

    const grouped = {};
    items.forEach(item => {
      const key = `${item.kecamatan}__${item.nama}`;
      if (!grouped[key]) {
        grouped[key] = {
          id: key.replace(/[^a-zA-Z0-9]/g, '_'),
          kecamatan: item.kecamatan,
          nama: item.nama,
          posisi: item.posisi || 'PPL Sensus',
          screenshots: []
        };
      }
      grouped[key].screenshots.push(item);
    });

    groupedOfficers = Object.values(grouped);
    currentPage = 1;
    renderCurrentPage();
  }

  function renderCurrentPage() {
    if (groupedOfficers.length === 0) {
      mergedContainer.innerHTML = '';
      emptyState.classList.remove('hidden');
      if (paginationBar) paginationBar.classList.add('hidden');
      return;
    }

    const totalPages = Math.ceil(groupedOfficers.length / ITEMS_PER_PAGE) || 1;
    currentPage = Math.max(1, Math.min(currentPage, totalPages));

    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIdx = startIdx + ITEMS_PER_PAGE;
    const pageItems = groupedOfficers.slice(startIdx, endIdx);

    mergedContainer.innerHTML = pageItems.map(group => {
      const initial = group.nama.charAt(0).toUpperCase();
      const cardId = group.id;

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

            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
              <button type="button" class="btn-toggle-gallery" id="btnToggle-${cardId}" onclick="toggleOfficerGallery('${cardId}', ${group.screenshots.length})">
                <i class="fa-solid fa-eye"></i> Tampilkan ${group.screenshots.length} Screenshot
              </button>
              <button type="button" class="btn-print" style="background: #0284c7;" onclick="printSingleOfficerReport('${escapeHTML(group.kecamatan)}', '${escapeHTML(group.nama)}')">
                <i class="fa-solid fa-file-pdf"></i> Unduh PDF
              </button>
              <button type="button" class="btn-print" style="background: #ef4444;" onclick="deleteAllOfficerScreenshots('${escapeHTML(group.kecamatan)}', '${escapeHTML(group.nama)}')">
                <i class="fa-solid fa-trash-can"></i> Hapus Semua
              </button>
            </div>
          </div>

          <div id="gallery-${cardId}" class="officer-gallery-grid hidden">
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

    renderPaginationControls(startIdx, endIdx, totalPages);
  }

  function renderPaginationControls(startIdx, endIdx, totalPages) {
    if (!paginationBar) return;

    if (groupedOfficers.length === 0) {
      paginationBar.classList.add('hidden');
      return;
    }

    paginationBar.classList.remove('hidden');

    const displayedEnd = Math.min(endIdx, groupedOfficers.length);
    paginationInfo.textContent = `Menampilkan ${startIdx + 1}-${displayedEnd} dari ${groupedOfficers.length} Petugas`;

    btnPrevPage.disabled = (currentPage <= 1);
    btnNextPage.disabled = (currentPage >= totalPages);

    pageNumbers.innerHTML = '';
    for (let i = 1; i <= totalPages; i++) {
      const pageBtn = document.createElement('button');
      pageBtn.type = 'button';
      pageBtn.className = `page-btn ${i === currentPage ? 'active' : ''}`;
      pageBtn.textContent = i;
      pageBtn.onclick = () => {
        currentPage = i;
        renderCurrentPage();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
      pageNumbers.appendChild(pageBtn);
    }
  }

  if (btnPrevPage) {
    btnPrevPage.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        renderCurrentPage();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  if (btnNextPage) {
    btnNextPage.addEventListener('click', () => {
      const totalPages = Math.ceil(groupedOfficers.length / ITEMS_PER_PAGE) || 1;
      if (currentPage < totalPages) {
        currentPage++;
        renderCurrentPage();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  window.toggleOfficerGallery = function(cardId, count) {
    const galleryEl = document.getElementById(`gallery-${cardId}`);
    const toggleBtn = document.getElementById(`btnToggle-${cardId}`);
    if (!galleryEl || !toggleBtn) return;

    if (galleryEl.classList.contains('hidden')) {
      galleryEl.classList.remove('hidden');
      toggleBtn.innerHTML = `<i class="fa-solid fa-eye-slash"></i> Sembunyikan ${count} Screenshot`;
      toggleBtn.style.background = '#f1f5f9';
      toggleBtn.style.color = '#475569';
      toggleBtn.style.borderColor = '#cbd5e1';
    } else {
      galleryEl.classList.add('hidden');
      toggleBtn.innerHTML = `<i class="fa-solid fa-eye"></i> Tampilkan ${count} Screenshot`;
      toggleBtn.style.background = '#eff6ff';
      toggleBtn.style.color = '#0284c7';
      toggleBtn.style.borderColor = '#bfdbfe';
    }
  };

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

  const btnDownloadFiltered = document.getElementById('btnDownloadFiltered');
  if (btnDownloadFiltered) {
    btnDownloadFiltered.addEventListener('click', () => {
      if (currentItems.length === 0) {
        showToast('Tidak ada data screenshot untuk diunduh', 'danger');
        return;
      }
      buildAndTriggerPrint(currentItems);
    });
  }

  // EXACT 2-PAGE PRINT / PDF REPORT SYSTEM (HALAMAN 1: CAPAIAN, HALAMAN 2: HAPUS)
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

  // Pre-convert proxy/http image URLs into inline Data URIs before printing to guarantee 100% instant picture rendering in PDF preview
  async function getBase64DataURI(url) {
    if (!url) return '';
    if (url.startsWith('data:')) return url;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(url);
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.error('Base64 pre-conversion failed:', err);
      return url;
    }
  }

  function buildAndTriggerPrint(itemsToPrint) {
    if (!itemsToPrint || itemsToPrint.length === 0) return;

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

    // Wait for all print images to load completely into browser memory before triggering print dialog
    const printImgs = Array.from(printContainer.querySelectorAll('img'));
    if (printImgs.length > 0) {
      showToast('Menyiapkan gambar lembar cetak...', 'info');
      await Promise.all(printImgs.map(img => {
        if (img.complete && img.naturalWidth !== 0) return Promise.resolve();
        return new Promise(resolve => {
          img.onload = resolve;
          img.onerror = resolve;
          setTimeout(resolve, 3000); // 3 second maximum fallback timeout
        });
      }));
    }

    setTimeout(() => {
      window.print();
    }, 150);
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
