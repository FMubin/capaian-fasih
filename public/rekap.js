/**
 * REKAP.JS - Portal Rekapitulasi & Cetak Organik BPS (Exact 2-Page Layout)
 */

document.addEventListener('DOMContentLoaded', () => {
  let kecamatanList = [];
  let masterPetugasList = [];
  let currentItems = [];
  let groupedOfficers = [];
  let currentPage = 1;
  const ITEMS_PER_PAGE = 10;

  let currentTab = 'galeri';
  let filteredStatusList = [];
  let currentStatusPage = 1;
  const STATUS_ITEMS_PER_PAGE = 50;

  const filterKecamatan = document.getElementById('filterKecamatan');
  const filterSearch = document.getElementById('filterSearch');
  const filterStatus = document.getElementById('filterStatus');
  const labelFilterStatus = document.getElementById('labelFilterStatus');
  const btnClearSearch = document.getElementById('btnClearSearch');
  const btnRefreshList = document.getElementById('btnRefreshList');
  const btnPrintAll = document.getElementById('btnPrintAll');
  const btnExportExcel = document.getElementById('btnExportExcel');

  const tabGaleri = document.getElementById('tabGaleri');
  const tabStatus = document.getElementById('tabStatus');
  const viewGaleri = document.getElementById('viewGaleri');
  const viewStatus = document.getElementById('viewStatus');

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
        masterPetugasList = json.data || [];
        kecamatanList = json.kecamatan || [];
        populateKecamatanDropdown();
        if (currentTab === 'status') renderStatusMonitoring();
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
        if (currentTab === 'status') renderStatusMonitoring();
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

  // Tab Switching Handlers
  if (tabGaleri && tabStatus) {
    tabGaleri.addEventListener('click', () => {
      currentTab = 'galeri';
      tabGaleri.style.borderBottomColor = '#0f4c81';
      tabGaleri.style.color = '#0f4c81';
      tabStatus.style.borderBottomColor = 'transparent';
      tabStatus.style.color = '#64748b';
      viewGaleri.classList.remove('hidden');
      viewStatus.classList.add('hidden');
      if (filterStatus) filterStatus.classList.add('hidden');
      if (labelFilterStatus) labelFilterStatus.classList.add('hidden');
    });

    tabStatus.addEventListener('click', () => {
      currentTab = 'status';
      tabStatus.style.borderBottomColor = '#0f4c81';
      tabStatus.style.color = '#0f4c81';
      tabGaleri.style.borderBottomColor = 'transparent';
      tabGaleri.style.color = '#64748b';
      viewStatus.classList.remove('hidden');
      viewGaleri.classList.add('hidden');
      if (filterStatus) filterStatus.classList.remove('hidden');
      if (labelFilterStatus) labelFilterStatus.classList.remove('hidden');
      renderStatusMonitoring();
    });
  }

  if (filterStatus) {
    filterStatus.addEventListener('change', renderStatusMonitoring);
  }

  // STATUS MONITORING TABLE & SUMMARY RENDERER
  function renderStatusMonitoring() {
    if (!masterPetugasList || masterPetugasList.length === 0) return;

    // Create a map of uploaded screenshots by "kecamatan__nama" (lowercased)
    const uploadedMapByKey = {};

    currentItems.forEach(item => {
      const kKec = (item.kecamatan || '').toLowerCase().trim();
      const kNama = (item.nama || '').toLowerCase().trim();
      const fullKey = `${kKec}__${kNama}`;

      if (!uploadedMapByKey[fullKey]) {
        uploadedMapByKey[fullKey] = {
          fullKey,
          kecamatan: item.kecamatan,
          nama: item.nama,
          posisi: item.posisi || 'PPL Sensus',
          capaianCount: 0,
          hapusCount: 0,
          total: 0,
          lastTime: item.created_at
        };
      }

      if ((item.jenis || '').includes('Hapus')) {
        uploadedMapByKey[fullKey].hapusCount++;
      } else {
        uploadedMapByKey[fullKey].capaianCount++;
      }
      uploadedMapByKey[fullKey].total++;
      if (new Date(item.created_at) > new Date(uploadedMapByKey[fullKey].lastTime)) {
        uploadedMapByKey[fullKey].lastTime = item.created_at;
      }
    });

    const usedUploadKeys = new Set();

    // Match all master officers strictly by kecamatan + nama
    const fullStatusList = masterPetugasList.map(p => {
      const kKec = (p.kecamatan || '').toLowerCase().trim();
      const kNama = (p.nama || '').toLowerCase().trim();
      const fullKey = `${kKec}__${kNama}`;

      let uploadData = null;
      if (uploadedMapByKey[fullKey] && !usedUploadKeys.has(fullKey)) {
        uploadData = uploadedMapByKey[fullKey];
        usedUploadKeys.add(fullKey);
      }

      const isUploaded = Boolean(uploadData && uploadData.total > 0);

      return {
        nama: p.nama,
        posisi: p.posisi || 'PPL Sensus',
        kecamatan: p.kecamatan,
        status: isUploaded ? 'SUDAH' : 'BELUM',
        countCapaian: uploadData ? uploadData.capaianCount : 0,
        countHapus: uploadData ? uploadData.hapusCount : 0,
        totalScreenshots: uploadData ? uploadData.total : 0,
        lastUploadTime: uploadData ? uploadData.lastTime : null
      };
    });

    // Append any uploaded officers that were not present in master data
    Object.keys(uploadedMapByKey).forEach(fullKey => {
      if (!usedUploadKeys.has(fullKey)) {
        const u = uploadedMapByKey[fullKey];
        fullStatusList.push({
          nama: u.nama,
          posisi: u.posisi || 'PPL Sensus',
          kecamatan: u.kecamatan,
          status: 'SUDAH',
          countCapaian: u.capaianCount,
          countHapus: u.hapusCount,
          totalScreenshots: u.total,
          lastUploadTime: u.lastTime
        });
      }
    });

    // Summary Card Stats
    const totalMaster = fullStatusList.length;
    const countSudah = fullStatusList.filter(s => s.status === 'SUDAH').length;
    const countBelum = totalMaster - countSudah;

    const percentSudah = totalMaster > 0 ? ((countSudah / totalMaster) * 100).toFixed(1) : '0';
    const percentBelum = totalMaster > 0 ? ((countBelum / totalMaster) * 100).toFixed(1) : '0';

    const elTotal = document.getElementById('sumTotalPetugas');
    const elSudah = document.getElementById('sumSudahUpload');
    const elBelum = document.getElementById('sumBelumUpload');

    if (elTotal) elTotal.textContent = `${totalMaster.toLocaleString('id-ID')} Petugas`;
    if (elSudah) elSudah.textContent = `${countSudah.toLocaleString('id-ID')} Petugas (${percentSudah}%)`;
    if (elBelum) elBelum.textContent = `${countBelum.toLocaleString('id-ID')} Petugas (${percentBelum}%)`;

    // Filtering based on Kecamatan, Search, and Status
    const selectedKec = filterKecamatan.value || 'SEMUA';
    const q = filterSearch.value.trim().toLowerCase();
    const statusVal = (filterStatus && filterStatus.value) || 'SEMUA';

    filteredStatusList = fullStatusList.filter(p => {
      if (selectedKec !== 'SEMUA' && p.kecamatan.toLowerCase() !== selectedKec.toLowerCase()) return false;
      if (statusVal !== 'SEMUA' && p.status !== statusVal) return false;
      if (q) {
        const matchName = p.nama.toLowerCase().includes(q);
        const matchKec = p.kecamatan.toLowerCase().includes(q);
        const matchPos = p.posisi.toLowerCase().includes(q);
        if (!matchName && !matchKec && !matchPos) return false;
      }
      return true;
    });

    currentStatusPage = 1;
    renderStatusTablePage();
  }

  function renderStatusTablePage() {
    const tableBody = document.getElementById('tableStatusBody');
    if (!tableBody) return;

    if (filteredStatusList.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: #64748b;">Tidak ada data petugas yang cocok dengan filter.</td></tr>`;
      const statusPagBar = document.getElementById('statusPaginationBar');
      if (statusPagBar) statusPagBar.classList.add('hidden');
      return;
    }

    const startIndex = (currentStatusPage - 1) * STATUS_ITEMS_PER_PAGE;
    const endIndex = Math.min(startIndex + STATUS_ITEMS_PER_PAGE, filteredStatusList.length);
    const pageItems = filteredStatusList.slice(startIndex, endIndex);

    let html = '';
    pageItems.forEach((p, idx) => {
      const num = startIndex + idx + 1;
      const statusBadge = p.status === 'SUDAH'
        ? `<span class="badge-sub-status sudah"><i class="fa-solid fa-circle-check"></i> Sudah Upload</span>`
        : `<span class="badge-sub-status belum"><i class="fa-solid fa-circle-xmark"></i> Belum Upload</span>`;

      const detailText = p.status === 'SUDAH'
        ? `<strong>${p.totalScreenshots} File</strong> (${p.countCapaian} Capaian, ${p.countHapus} Hapus)`
        : `<span style="color: #94a3b8;">-</span>`;

      const timeText = p.lastUploadTime
        ? formatDate(p.lastUploadTime)
        : `<span style="color: #94a3b8;">-</span>`;

      html += `
        <tr>
          <td style="font-weight: 600; color: #64748b;">${num}</td>
          <td style="font-weight: 700; color: #0f172a;">${escapeHTML(p.nama)}</td>
          <td>${escapeHTML(p.posisi)}</td>
          <td><span style="font-weight: 600; color: #0284c7;">${escapeHTML(p.kecamatan)}</span></td>
          <td style="text-align: center;">${statusBadge}</td>
          <td style="text-align: center;">${detailText}</td>
          <td style="font-size: 0.8rem; color: #475569;">${timeText}</td>
        </tr>
      `;
    });

    tableBody.innerHTML = html;
    renderStatusPagination(filteredStatusList.length);
  }

  function renderStatusPagination(totalItems) {
    const statusPagBar = document.getElementById('statusPaginationBar');
    const statusPagInfo = document.getElementById('statusPaginationInfo');
    const statusPageNums = document.getElementById('statusPageNumbers');
    const btnPrev = document.getElementById('btnStatusPrevPage');
    const btnNext = document.getElementById('btnStatusNextPage');

    if (!statusPagBar || totalItems <= STATUS_ITEMS_PER_PAGE) {
      if (statusPagBar) statusPagBar.classList.add('hidden');
      return;
    }

    statusPagBar.classList.remove('hidden');

    const totalPages = Math.ceil(totalItems / STATUS_ITEMS_PER_PAGE);
    currentStatusPage = Math.max(1, Math.min(currentStatusPage, totalPages));

    const startIdx = (currentStatusPage - 1) * STATUS_ITEMS_PER_PAGE + 1;
    const endIdx = Math.min(currentStatusPage * STATUS_ITEMS_PER_PAGE, totalItems);

    statusPagInfo.textContent = `Menampilkan ${startIdx}-${endIdx} dari ${totalItems.toLocaleString('id-ID')} Petugas`;

    btnPrev.disabled = currentStatusPage === 1;
    btnNext.disabled = currentStatusPage === totalPages;

    btnPrev.onclick = () => {
      if (currentStatusPage > 1) {
        currentStatusPage--;
        renderStatusTablePage();
      }
    };

    btnNext.onclick = () => {
      if (currentStatusPage < totalPages) {
        currentStatusPage++;
        renderStatusTablePage();
      }
    };

    let pagesHTML = '';
    const maxButtons = 5;
    let startPage = Math.max(1, currentStatusPage - 2);
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage < maxButtons - 1) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      const activeClass = i === currentStatusPage ? 'active' : '';
      pagesHTML += `<button type="button" class="page-btn ${activeClass}" onclick="goToStatusPage(${i})">${i}</button>`;
    }
    statusPageNums.innerHTML = pagesHTML;
  }

  window.goToStatusPage = function(pageNum) {
    currentStatusPage = pageNum;
    renderStatusTablePage();
  };

  // Export Status List to Excel (.xlsx)
  if (btnExportExcel) {
    btnExportExcel.addEventListener('click', () => {
      if (!filteredStatusList || filteredStatusList.length === 0) {
        renderStatusMonitoring();
      }

      if (!filteredStatusList || filteredStatusList.length === 0) {
        showToast('Tidak ada data petugas yang cocok untuk diexport ke Excel.', 'danger');
        return;
      }

      const selectedKec = filterKecamatan.value || 'SEMUA';
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `Rekap_Status_Upload_FASIH_${selectedKec.replace(/[^a-zA-Z0-9]/g, '_')}_${dateStr}.xlsx`;

      exportStatusListToExcel(filteredStatusList, filename);
    });
  }

  function exportStatusListToExcel(list, filename) {
    showToast('Menyiapkan file Excel (.xlsx)...', 'info');

    const excelRows = list.map((item, idx) => ({
      'No': idx + 1,
      'Nama Lengkap Petugas': item.nama,
      'Posisi Petugas': item.posisi,
      'Kecamatan Tugas': item.kecamatan,
      'Status Upload': item.status === 'SUDAH' ? 'Sudah Upload' : 'Belum Upload',
      'Jumlah Screenshot Capaian': item.countCapaian || 0,
      'Jumlah Screenshot Hapus': item.countHapus || 0,
      'Total File Screenshot': item.totalScreenshots || 0,
      'Waktu Upload Terakhir': item.lastUploadTime ? formatDate(item.lastUploadTime) : '-'
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Rekap Status Upload');

    // Set column widths
    worksheet['!cols'] = [
      { wch: 6 },  // No
      { wch: 32 }, // Nama
      { wch: 42 }, // Posisi
      { wch: 22 }, // Kecamatan
      { wch: 20 }, // Status
      { wch: 26 }, // Capaian
      { wch: 26 }, // Hapus
      { wch: 20 }, // Total
      { wch: 28 }  // Waktu
    ];

    XLSX.writeFile(workbook, filename);
    showToast(`File Excel "${filename}" berhasil diunduh!`, 'success');
  }

  // Filter Events
  filterKecamatan.addEventListener('change', () => {
    fetchCapaianList();
    if (currentTab === 'status') renderStatusMonitoring();
  });

  let searchTimeout;
  filterSearch.addEventListener('input', (e) => {
    if (e.target.value.trim() !== '') btnClearSearch.classList.remove('hidden');
    else btnClearSearch.classList.add('hidden');
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      fetchCapaianList();
      if (currentTab === 'status') renderStatusMonitoring();
    }, 300);
  });

  btnClearSearch.addEventListener('click', () => {
    filterSearch.value = '';
    btnClearSearch.classList.add('hidden');
    fetchCapaianList();
    if (currentTab === 'status') renderStatusMonitoring();
  });

  btnRefreshList.addEventListener('click', () => {
    fetchCapaianList();
    if (currentTab === 'status') renderStatusMonitoring();
  });

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

  // Hapus Data Screenshot Berdasarkan Kecamatan yang Difilter
  const btnDeleteKecamatan = document.getElementById('btnDeleteKecamatan');
  if (btnDeleteKecamatan) {
    btnDeleteKecamatan.addEventListener('click', async () => {
      const selectedKec = filterKecamatan.value;
      if (!selectedKec || selectedKec === 'SEMUA') {
        showToast('Pilih kecamatan spesifik terlebih dahulu pada dropdown filter!', 'danger');
        filterKecamatan.focus();
        return;
      }

      const confirmMsg = `PERINGATAN: Apakah Anda yakin ingin menghapus SELURUH screenshot milik SEMUA PETUGAS di Kecamatan "${selectedKec}"?\n\nTindakan ini tidak dapat dibatalkan!`;
      if (!confirm(confirmMsg)) return;

      try {
        const res = await fetch('/api/capaian-kecamatan', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kecamatan: selectedKec })
        });
        const json = await res.json();
        if (json.success) {
          showToast(json.message, 'success');
          fetchCapaianList();
        } else {
          showToast(json.message || 'Gagal menghapus data kecamatan', 'danger');
        }
      } catch (err) {
        showToast('Terjadi kesalahan saat menghapus data kecamatan', 'danger');
      }
    });
  }

  // Hapus SELURUH Data Screenshot di Aplikasi (Hapus Semua)
  const btnDeleteAll = document.getElementById('btnDeleteAll');
  if (btnDeleteAll) {
    btnDeleteAll.addEventListener('click', async () => {
      const confirm1 = confirm('⚠️ PERINGATAN BAHAYA!\n\nApakah Anda benar-benar yakin ingin MENGHAPUS SELURUH DATA SCREENSHOT (SEMUA KECAMATAN & SEMUA PETUGAS)?\n\nSemua bukti screenshot yang pernah diunggah akan TERHAPUS PERMANEN!');
      if (!confirm1) return;

      const confirmText = prompt('Ketik kata "HAPUS" (huruf kapital) di bawah ini untuk mengonfirmasi penghapusan seluruh data:');
      if (confirmText !== 'HAPUS') {
        showToast('Penghapusan dibatalkan. Kata konfirmasi tidak sesuai.', 'info');
        return;
      }

      try {
        const res = await fetch('/api/capaian-all', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmText: 'HAPUS' })
        });
        const json = await res.json();
        if (json.success) {
          showToast(json.message, 'success');
          fetchCapaianList();
        } else {
          showToast(json.message || 'Gagal menghapus seluruh data', 'danger');
        }
      } catch (err) {
        showToast('Terjadi kesalahan server saat menghapus seluruh data', 'danger');
      }
    });
  }

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

  async function buildAndTriggerPrint(itemsToPrint) {
    if (!itemsToPrint || itemsToPrint.length === 0) return;

    showToast('Menyiapkan gambar & dokumen PDF...', 'info');

    // 1. Try fast bulk fetch via /api/officer-images
    const ids = itemsToPrint.map(i => i.id).join(',');
    let imageMap = {};

    try {
      const res = await fetch(`/api/officer-images?ids=${encodeURIComponent(ids)}`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        json.data.forEach(imgObj => {
          imageMap[imgObj.id] = imgObj.file_url;
        });
      }
    } catch (err) {
      console.error('Failed to fetch officer images for print:', err);
    }

    // 2. Convert all item URLs to full inline Base64 Data URIs so PDF preview renders 100% crisp & complete
    const preparedItems = await Promise.all(itemsToPrint.map(async item => {
      let targetUrl = imageMap[item.id] || item.file_url;
      const inlineDataUri = await getBase64DataURI(targetUrl);
      return {
        ...item,
        file_url: inlineDataUri
      };
    }));

    const grouped = {};
    preparedItems.forEach(item => {
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
    let globalPageCounter = 1;

    Object.values(grouped).forEach((group) => {
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
      // CAPAIAN PETUGAS PAGE
      // ----------------------------------------------------
      const capaianPageNum = globalPageCounter++;
      const capaianBreakClass = capaianPageNum === 1 ? '' : 'print-page-break';

      printHTML += `
        <div class="print-page-wrapper ${capaianBreakClass}">
          <div class="print-header">
            <h2>BADAN PUSAT STATISTIK</h2>
            <p>HALAMAN ${capaianPageNum}: REKAPITULASI DOKUMENTASI CAPAIAN PETUGAS</p>
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
      // HAPUS APLIKASI FASIH PAGE
      // ----------------------------------------------------
      const hapusPageNum = globalPageCounter++;

      printHTML += `
        <div class="print-page-wrapper print-page-break">
          <div class="print-header">
            <h2>BADAN PUSAT STATISTIK</h2>
            <p>HALAMAN ${hapusPageNum}: REKAPITULASI HAPUS APLIKASI FASIH / PERIODE SENSUS</p>
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
