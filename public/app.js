/**
 * APP.JS - Sistem Upload Screenshot (Multi-File) & Rekap Cetak Organik BPS
 */

document.addEventListener('DOMContentLoaded', () => {
  // State variables
  let masterKecamatan = [];
  let currentItems = [];
  let selectedFilesList = [];
  let itemToDelete = null;
  let activeRole = 'PPL'; // 'PPL' or 'Organik Admin'

  // DOM Elements - Role Buttons & Banner
  const btnRolePPL = document.getElementById('btnRolePPL');
  const btnRoleAdmin = document.getElementById('btnRoleAdmin');
  const roleBanner = document.getElementById('roleBanner');
  const bannerIcon = document.getElementById('bannerIcon');
  const bannerText = document.getElementById('bannerText');

  // DOM Elements - Form & Dropzone
  const selectRolePetugas = document.getElementById('selectRolePetugas');
  const selectJenis = document.getElementById('selectJenis');
  const selectKecamatan = document.getElementById('selectKecamatan');
  const selectPetugas = document.getElementById('selectPetugas');
  const inputCatatan = document.getElementById('inputCatatan');
  const uploadForm = document.getElementById('uploadForm');
  const btnSubmitUpload = document.getElementById('btnSubmitUpload');

  const dropzone = document.getElementById('dropzone');
  const inputFile = document.getElementById('inputFile');
  const dropzonePrompt = document.getElementById('dropzonePrompt');
  const previewContainer = document.getElementById('previewContainer');
  const previewCountBadge = document.getElementById('previewCountBadge');
  const multiPreviewGrid = document.getElementById('multiPreviewGrid');
  const btnRemoveAllFiles = document.getElementById('btnRemoveAllFiles');

  // DOM Elements - Filtering & Merged View
  const filterKecamatan = document.getElementById('filterKecamatan');
  const filterJenis = document.getElementById('filterJenis');
  const filterSearch = document.getElementById('filterSearch');
  const btnClearSearch = document.getElementById('btnClearSearch');
  const btnRefreshList = document.getElementById('btnRefreshList');
  const btnPrintAll = document.getElementById('btnPrintAll');

  const mergedContainer = document.getElementById('mergedContainer');
  const emptyState = document.getElementById('emptyState');
  const printContainer = document.getElementById('printContainer');

  // Modal Elements
  const modalLightbox = document.getElementById('modalLightbox');
  const lightboxImage = document.getElementById('lightboxImage');
  const lightboxTitle = document.getElementById('lightboxTitle');
  const lightboxJenisBadge = document.getElementById('lightboxJenisBadge');
  const lightboxCatatan = document.getElementById('lightboxCatatan');
  const lightboxTime = document.getElementById('lightboxTime');
  const btnDownloadImage = document.getElementById('btnDownloadImage');
  const btnCloseLightbox = document.getElementById('btnCloseLightbox');

  const modalAddPetugas = document.getElementById('modalAddPetugas');
  const modalKecamatanNama = document.getElementById('modalKecamatanNama');
  const modalRolePetugas = document.getElementById('modalRolePetugas');
  const modalPetugasNama = document.getElementById('modalPetugasNama');
  const btnOpenAddPetugasModal = document.getElementById('btnOpenAddPetugasModal');
  const btnSavePetugas = document.getElementById('btnSavePetugas');
  const btnCancelAddPetugas = document.getElementById('btnCancelAddPetugas');
  const btnClosePetugasModal = document.getElementById('btnClosePetugasModal');

  // Initial Setup
  fetchMasterData();
  fetchCapaianList();

  // ==========================================
  // 1. ROLE SWITCHER
  // ==========================================
  btnRolePPL.addEventListener('click', () => switchRole('PPL'));
  btnRoleAdmin.addEventListener('click', () => switchRole('Organik Admin'));

  function switchRole(role) {
    activeRole = role;
    btnRolePPL.classList.remove('active');
    btnRoleAdmin.classList.remove('active');

    if (role === 'PPL') {
      btnRolePPL.classList.add('active');
      bannerIcon.className = 'fa-solid fa-user-pen';
      bannerText.innerHTML = 'Silakan pilih Kecamatan & Nama Petugas Anda, lalu pilih <strong>bisa lebih dari 1 gambar screenshot</strong> untuk diunggah sekaligus.';
    } else {
      btnRoleAdmin.classList.add('active');
      bannerIcon.className = 'fa-solid fa-print';
      bannerText.innerHTML = 'Anda berada pada mode <strong>Organik BPS</strong>. Seluruh screenshot dari petugas otomatis digabung per nama petugas dan siap untuk langsung dicetak.';
    }
  }

  // ==========================================
  // 2. MASTER DATA & DROPDOWNS
  // ==========================================
  async function fetchMasterData() {
    try {
      const res = await fetch('/api/master-data');
      const json = await res.json();
      if (json.success) {
        masterKecamatan = json.data;
        populateKecamatanDropdowns();
      }
    } catch (err) {
      console.error('Failed to fetch master data:', err);
      showToast('Gagal memuat daftar kecamatan', 'danger');
    }
  }

  function populateKecamatanDropdowns() {
    selectKecamatan.innerHTML = '<option value="" disabled selected>-- Pilih Kecamatan --</option>';
    filterKecamatan.innerHTML = '<option value="SEMUA">Semua Kecamatan</option>';

    masterKecamatan.forEach(kec => {
      const opt1 = document.createElement('option');
      opt1.value = kec.nama;
      opt1.textContent = kec.nama;
      selectKecamatan.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = kec.nama;
      opt2.textContent = kec.nama;
      filterKecamatan.appendChild(opt2);
    });
  }

  selectKecamatan.addEventListener('change', (e) => {
    updatePetugasDropdown(e.target.value);
  });

  selectRolePetugas.addEventListener('change', () => {
    if (selectKecamatan.value) updatePetugasDropdown(selectKecamatan.value);
  });

  function updatePetugasDropdown(kecNama) {
    const targetKec = masterKecamatan.find(k => k.nama === kecNama);
    selectPetugas.innerHTML = '<option value="" disabled selected>-- Pilih Nama Petugas --</option>';

    if (!targetKec) return;

    const roleVal = selectRolePetugas.value;
    const listKey = roleVal.toLowerCase() === 'pml' ? 'pml' : 'ppl';
    const officers = targetKec[listKey] || [];

    officers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      selectPetugas.appendChild(opt);
    });

    const optNew = document.createElement('option');
    optNew.value = "__ADD_NEW__";
    optNew.textContent = `➕ Tambah Nama ${roleVal} Baru...`;
    optNew.style.fontWeight = "bold";
    optNew.style.color = "#2563eb";
    selectPetugas.appendChild(optNew);

    selectPetugas.disabled = false;
  }

  selectPetugas.addEventListener('change', (e) => {
    if (e.target.value === "__ADD_NEW__") {
      openAddPetugasModal();
    }
  });

  // ==========================================
  // 3. MULTI-FILE DROPZONE HANDLER
  // ==========================================
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt.files && dt.files.length > 0) {
      addFilesToList(Array.from(dt.files));
    }
  });

  inputFile.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToList(Array.from(e.target.files));
    }
  });

  function addFilesToList(files) {
    const validImageFiles = files.filter(f => f.type.startsWith('image/'));

    if (validImageFiles.length === 0) {
      showToast('Harap pilih file gambar (JPG, PNG, WEBP, GIF)!', 'danger');
      return;
    }

    // Add to state
    validImageFiles.forEach(f => selectedFilesList.push(f));
    renderMultiPreviews();
  }

  function renderMultiPreviews() {
    if (selectedFilesList.length === 0) {
      dropzonePrompt.classList.remove('hidden');
      previewContainer.classList.add('hidden');
      multiPreviewGrid.innerHTML = '';
      return;
    }

    dropzonePrompt.classList.add('hidden');
    previewContainer.classList.remove('hidden');
    previewCountBadge.textContent = `${selectedFilesList.length} Gambar Dipilih`;

    multiPreviewGrid.innerHTML = '';

    selectedFilesList.forEach((file, index) => {
      const card = document.createElement('div');
      card.className = 'preview-thumb-card';

      const img = document.createElement('img');
      const reader = new FileReader();
      reader.onload = (e) => { img.src = e.target.result; };
      reader.readAsDataURL(file);

      const btnRemove = document.createElement('button');
      btnRemove.type = 'button';
      btnRemove.className = 'btn-remove-thumb';
      btnRemove.innerHTML = '&times;';
      btnRemove.title = 'Hapus Gambar Ini';
      btnRemove.onclick = (e) => {
        e.stopPropagation();
        selectedFilesList.splice(index, 1);
        renderMultiPreviews();
      };

      card.appendChild(img);
      card.appendChild(btnRemove);
      multiPreviewGrid.appendChild(card);
    });
  }

  btnRemoveAllFiles.addEventListener('click', (e) => {
    e.stopPropagation();
    selectedFilesList = [];
    inputFile.value = '';
    renderMultiPreviews();
  });

  // ==========================================
  // 4. BATCH UPLOAD FORM SUBMISSION
  // ==========================================
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const selectedKec = selectKecamatan.value;
    const selectedPetugas = selectPetugas.value;

    if (!selectedKec) {
      showToast('Pilih Kecamatan terlebih dahulu!', 'danger');
      return;
    }

    if (!selectedPetugas || selectedPetugas === '__ADD_NEW__') {
      showToast('Pilih Nama Petugas terlebih dahulu!', 'danger');
      return;
    }

    if (selectedFilesList.length === 0) {
      showToast('Pilih minimal 1 file gambar screenshot!', 'danger');
      return;
    }

    const formData = new FormData();
    formData.append('kecamatan', selectedKec);
    formData.append('petugas', selectedPetugas);
    formData.append('role_pengunggah', selectRolePetugas.value);
    formData.append('jenis', selectJenis.value);
    formData.append('catatan', inputCatatan.value.trim());

    selectedFilesList.forEach(file => {
      formData.append('files', file);
    });

    btnSubmitUpload.disabled = true;
    btnSubmitUpload.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Mengunggah ${selectedFilesList.length} Screenshot...`;

    try {
      const res = await fetch('/api/capaian', {
        method: 'POST',
        body: formData
      });
      const json = await res.json();

      if (json.success) {
        showToast(json.message, 'success');
        
        uploadForm.reset();
        selectedFilesList = [];
        inputFile.value = '';
        renderMultiPreviews();
        selectPetugas.disabled = true;
        selectPetugas.innerHTML = '<option value="" disabled selected>-- Pilih Kecamatan Terlebih Dahulu --</option>';

        fetchMasterData();
        fetchCapaianList();
      } else {
        showToast(json.message || 'Gagal mengunggah', 'danger');
      }
    } catch (err) {
      console.error('Error batch upload:', err);
      showToast('Terjadi kesalahan server saat mengunggah.', 'danger');
    } finally {
      btnSubmitUpload.disabled = false;
      btnSubmitUpload.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Upload Seluruh Screenshot Sekarang';
    }
  });

  // ==========================================
  // 5. FETCH & MERGE SCREENSHOTS PER PETUGAS
  // ==========================================
  async function fetchCapaianList() {
    const kec = filterKecamatan.value || 'SEMUA';
    const jns = filterJenis.value || 'SEMUA';
    const q = filterSearch.value.trim();

    const params = new URLSearchParams();
    if (kec !== 'SEMUA') params.append('kecamatan', kec);
    if (jns !== 'SEMUA') params.append('jenis', jns);
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

    // Group items per (Petugas + Kecamatan)
    const grouped = {};

    items.forEach(item => {
      const key = `${item.kecamatan}__${item.petugas}`;
      if (!grouped[key]) {
        grouped[key] = {
          kecamatan: item.kecamatan,
          petugas: item.petugas,
          role: item.role_pengunggah || 'PPL',
          screenshots: []
        };
      }
      grouped[key].screenshots.push(item);
    });

    mergedContainer.innerHTML = Object.values(grouped).map(group => {
      const initial = group.petugas.charAt(0).toUpperCase();

      return `
        <div class="officer-card">
          <div class="officer-card-header">
            <div class="officer-meta">
              <div class="officer-avatar">${initial}</div>
              <div class="officer-title">
                <h3>${escapeHTML(group.petugas)} (${group.role})</h3>
                <p><i class="fa-solid fa-location-dot"></i> ${escapeHTML(group.kecamatan)} &bull; ${group.screenshots.length} Screenshot Unggahan</p>
              </div>
            </div>

            <div class="officer-actions">
              <button type="button" class="btn btn-success btn-sm" onclick="printSingleOfficerReport('${escapeHTML(group.kecamatan)}', '${escapeHTML(group.petugas)}')">
                <i class="fa-solid fa-print"></i> Cetak Lembar Petugas Ini
              </button>
              <button type="button" class="btn btn-danger btn-sm" onclick="deleteAllOfficerScreenshots('${escapeHTML(group.kecamatan)}', '${escapeHTML(group.petugas)}')">
                <i class="fa-solid fa-trash-can"></i> Hapus Seluruh Gambar
              </button>
            </div>
          </div>

          <div class="officer-gallery-grid">
            ${group.screenshots.map(s => {
              const isCapaian = s.jenis === 'Capaian FASIH';
              const tagClass = isCapaian ? 'capaian' : 'hapus';

              return `
                <div class="screenshot-item" onclick="openLightbox('${s.id}')">
                  <img src="${s.file_url}" alt="Screenshot" loading="lazy">
                  <span class="item-jenis-tag ${tagClass}">${s.jenis}</span>
                  <button type="button" class="item-delete-btn" onclick="event.stopPropagation(); deleteSingleScreenshot('${s.id}')" title="Hapus Gambar Ini">&times;</button>
                  <div class="item-caption">${s.catatan ? escapeHTML(s.catatan) : formatDate(s.created_at)}</div>
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
  filterJenis.addEventListener('change', fetchCapaianList);

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

  // ==========================================
  // 6. DIRECT PRINT REPORT SYSTEM (ORGANIK BPS)
  // ==========================================
  btnPrintAll.addEventListener('click', () => {
    if (currentItems.length === 0) {
      showToast('Tidak ada data screenshot untuk dicetak', 'danger');
      return;
    }
    buildAndTriggerPrint(currentItems, 'SELURUH REKAP PETUGAS LAPANGAN');
  });

  window.printSingleOfficerReport = function(kecamatan, petugas) {
    const officerItems = currentItems.filter(i => i.kecamatan.toLowerCase() === kecamatan.toLowerCase() && i.petugas.toLowerCase() === petugas.toLowerCase());
    if (officerItems.length === 0) return;
    buildAndTriggerPrint(officerItems, `REKAP CAPAIAN - ${petugas.toUpperCase()} (${kecamatan.toUpperCase()})`);
  };

  function buildAndTriggerPrint(itemsToPrint, titleHeader) {
    // Group items per officer for print sheet layout
    const grouped = {};
    itemsToPrint.forEach(item => {
      const key = `${item.kecamatan}__${item.petugas}`;
      if (!grouped[key]) {
        grouped[key] = {
          kecamatan: item.kecamatan,
          petugas: item.petugas,
          role: item.role_pengunggah || 'PPL',
          screenshots: []
        };
      }
      grouped[key].screenshots.push(item);
    });

    const nowStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    printContainer.innerHTML = `
      <div class="print-header">
        <h2>BADAN PUSAT STATISTIK</h2>
        <p>REKAPITULASI DOKUMENTASI SCREENSHOT CAPAIAN / HAPUS FASIH</p>
        <small style="font-style: italic;">${titleHeader} &bull; Tanggal Cetak: ${nowStr}</small>
      </div>

      ${Object.values(grouped).map(group => `
        <div class="print-officer-block">
          <div class="print-officer-info">
            <strong>NAMA PETUGAS:</strong> ${escapeHTML(group.petugas)} (${group.role})<br>
            <strong>KECAMATAN:</strong> ${escapeHTML(group.kecamatan)}<br>
            <strong>JUMLAH SCREENSHOT:</strong> ${group.screenshots.length} File Gambar
          </div>

          <div class="print-grid">
            ${group.screenshots.map(s => `
              <div class="print-image-card">
                <img src="${s.file_url}" alt="Screenshot Cetak">
                <div class="print-image-caption">
                  [${s.jenis}] ${s.catatan ? escapeHTML(s.catatan) : ''} (${formatDate(s.created_at)})
                </div>
              </div>
            `).join('')}
          </div>

          <div class="print-signatures">
            <div class="sig-box">
              Petugas Lapangan,
              <div class="sig-space"></div>
              ( <u>${escapeHTML(group.petugas)}</u> )
            </div>
            <div class="sig-box">
              Penerima Organik BPS,
              <div class="sig-space"></div>
              ( _______________________ )
            </div>
          </div>
        </div>
      `).join('')}
    `;

    setTimeout(() => {
      window.print();
    }, 200);
  }

  // ==========================================
  // 7. DELETE ACTIONS
  // ==========================================
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

  window.deleteAllOfficerScreenshots = async function(kecamatan, petugas) {
    if (!confirm(`Apakah Anda yakin ingin menghapus SELURUH screenshot milik ${petugas}?`)) return;

    try {
      const res = await fetch('/api/capaian-petugas', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kecamatan, petugas })
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

  // ==========================================
  // 8. LIGHTBOX & MODALS
  // ==========================================
  window.openLightbox = function(id) {
    const item = currentItems.find(i => i.id === id);
    if (!item) return;

    lightboxImage.src = item.file_url;
    lightboxTitle.textContent = `${item.petugas} (${item.role_pengunggah || 'PPL'}) - ${item.kecamatan}`;
    lightboxJenisBadge.textContent = item.jenis;
    lightboxJenisBadge.style.backgroundColor = item.jenis === 'Capaian FASIH' ? 'var(--teal-500)' : 'var(--coral-500)';
    lightboxCatatan.textContent = item.catatan ? `Catatan: ${item.catatan}` : 'Tanpa Catatan';
    lightboxTime.textContent = `Waktu Upload: ${formatDate(item.created_at)}`;
    btnDownloadImage.href = item.file_url;
    btnDownloadImage.download = item.original_name || `${item.jenis}_${item.petugas}.png`;

    modalLightbox.classList.remove('hidden');
  };

  btnCloseLightbox.addEventListener('click', () => modalLightbox.classList.add('hidden'));

  function openAddPetugasModal() {
    const selectedKecNama = selectKecamatan.value;
    if (!selectedKecNama) {
      showToast('Pilih Kecamatan terlebih dahulu!', 'danger');
      return;
    }
    modalKecamatanNama.value = selectedKecNama;
    modalRolePetugas.value = selectRolePetugas.value;
    modalPetugasNama.value = '';
    modalAddPetugas.classList.remove('hidden');
  }

  function closeAddPetugasModal() {
    modalAddPetugas.classList.add('hidden');
    if (selectPetugas.value === '__ADD_NEW__') selectPetugas.value = '';
  }

  btnOpenAddPetugasModal.addEventListener('click', openAddPetugasModal);
  btnCancelAddPetugas.addEventListener('click', closeAddPetugasModal);
  btnClosePetugasModal.addEventListener('click', closeAddPetugasModal);

  btnSavePetugas.addEventListener('click', async () => {
    const kecNama = modalKecamatanNama.value;
    const rolePet = modalRolePetugas.value;
    const petNama = modalPetugasNama.value.trim();

    if (!petNama) {
      showToast('Ketik Nama Petugas baru!', 'danger');
      return;
    }

    try {
      const res = await fetch('/api/petugas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kecamatanNama: kecNama, rolePetugas: rolePet, petugasNama: petNama })
      });
      const json = await res.json();

      if (json.success) {
        showToast(`Petugas ${rolePet} "${petNama}" berhasil ditambahkan!`, 'success');
        closeAddPetugasModal();

        masterKecamatan = json.data;
        updatePetugasDropdown(kecNama);
        selectPetugas.value = petNama;
      }
    } catch (err) {
      showToast('Gagal menyimpan petugas', 'danger');
    }
  });

  // Helpers
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
