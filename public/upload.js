/**
 * UPLOAD.JS - Form Upload Screenshot Capaian & Hapus Fasih (2 Dropzone Atas-Bawah)
 */

document.addEventListener('DOMContentLoaded', () => {
  let masterPetugasList = [];
  let kecamatanList = [];
  
  let filesCapaianList = [];
  let filesHapusList = [];

  // DOM Elements
  const selectKecamatan = document.getElementById('selectKecamatan');
  const selectPetugas = document.getElementById('selectPetugas');
  const posisiBadge = document.getElementById('posisiBadge');
  const inputPosisi = document.getElementById('inputPosisi');

  // Dropzone 1 (Capaian)
  const dropzoneCapaian = document.getElementById('dropzoneCapaian');
  const inputFileCapaian = document.getElementById('inputFileCapaian');
  const promptCapaian = document.getElementById('promptCapaian');
  const containerCapaian = document.getElementById('containerCapaian');
  const badgeCapaian = document.getElementById('badgeCapaian');
  const gridCapaian = document.getElementById('gridCapaian');
  const btnRemoveCapaian = document.getElementById('btnRemoveCapaian');

  // Dropzone 2 (Hapus)
  const dropzoneHapus = document.getElementById('dropzoneHapus');
  const inputFileHapus = document.getElementById('inputFileHapus');
  const promptHapus = document.getElementById('promptHapus');
  const containerHapus = document.getElementById('containerHapus');
  const badgeHapus = document.getElementById('badgeHapus');
  const gridHapus = document.getElementById('gridHapus');
  const btnRemoveHapus = document.getElementById('btnRemoveHapus');

  const maintenanceOverlay = document.getElementById('maintenanceOverlay');

  checkMaintenanceMode();
  fetchMasterData();

  async function checkMaintenanceMode() {
    try {
      const res = await fetch('/api/maintenance');
      const json = await res.json();
      if (json.success && json.maintenance) {
        if (maintenanceOverlay) maintenanceOverlay.classList.remove('hidden');
      } else {
        if (maintenanceOverlay) maintenanceOverlay.classList.add('hidden');
      }
    } catch (err) {
      console.error('Failed to check maintenance mode:', err);
    }
  }

  async function fetchMasterData() {
    try {
      const res = await fetch('/api/master-data');
      const json = await res.json();
      if (json.success) {
        masterPetugasList = json.data || [];
        kecamatanList = json.kecamatan || [];
        populateKecamatanDropdown();
      }
    } catch (err) {
      console.error('Failed to fetch master data:', err);
      showToast('Gagal memuat master data petugas', 'danger');
    }
  }

  function populateKecamatanDropdown() {
    selectKecamatan.innerHTML = '<option value="" disabled selected>Semua Kecamatan / Pilih Kecamatan...</option>';
    
    const optAll = document.createElement('option');
    optAll.value = "SEMUA";
    optAll.textContent = "Semua Kecamatan (Tampilkan Semua Petugas)";
    selectKecamatan.appendChild(optAll);

    kecamatanList.forEach(kec => {
      const opt = document.createElement('option');
      opt.value = kec;
      opt.textContent = kec;
      selectKecamatan.appendChild(opt);
    });
  }

  selectKecamatan.addEventListener('change', (e) => {
    updatePetugasDropdown(e.target.value);
  });

  function updatePetugasDropdown(kecNama) {
    selectPetugas.innerHTML = '<option value="" disabled selected>Cari Nama Petugas...</option>';
    posisiBadge.classList.add('hidden');

    let filtered = masterPetugasList;
    if (kecNama && kecNama !== 'SEMUA') {
      filtered = masterPetugasList.filter(p => p.kecamatan.toLowerCase() === kecNama.toLowerCase());
    }

    if (filtered.length === 0) {
      const optEmpty = document.createElement('option');
      optEmpty.value = "";
      optEmpty.disabled = true;
      optEmpty.textContent = "Belum Ada Petugas Terdaftar di Kecamatan Ini";
      selectPetugas.appendChild(optEmpty);
    } else {
      filtered.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.nama;
        opt.textContent = `${p.nama} (${p.posisi} - ${p.kecamatan})`;
        opt.dataset.posisi = p.posisi;
        opt.dataset.kecamatan = p.kecamatan;
        selectPetugas.appendChild(opt);
      });
    }

    const optNew = document.createElement('option');
    optNew.value = "__ADD_NEW__";
    optNew.textContent = "➕ Tambah Nama Petugas Baru...";
    optNew.style.fontWeight = "bold";
    optNew.style.color = "#f97316";
    selectPetugas.appendChild(optNew);

    selectPetugas.disabled = false;
  }

  selectPetugas.addEventListener('change', (e) => {
    const val = e.target.value;

    if (val === '__ADD_NEW__') {
      const newName = prompt('Masukkan Nama Lengkap Petugas Baru:');
      if (!newName || !newName.trim()) {
        selectPetugas.value = '';
        return;
      }
      const newPosisi = prompt('Masukkan Posisi Petugas (contoh: PPL Sensus atau PML Sensus):', 'PPL Sensus') || 'PPL Sensus';
      const kecVal = selectKecamatan.value !== 'SEMUA' ? selectKecamatan.value : 'Saketi';

      saveNewPetugas(kecVal, newPosisi, newName.trim());
      return;
    }

    const selectedOption = selectPetugas.options[selectPetugas.selectedIndex];
    if (selectedOption && selectedOption.dataset.posisi) {
      const pos = selectedOption.dataset.posisi;
      inputPosisi.value = pos;
      posisiBadge.textContent = `Posisi: ${pos}`;
      posisiBadge.classList.remove('hidden');

      const currentKec = (selectKecamatan.value === 'SEMUA' && selectedOption.dataset.kecamatan) 
        ? selectedOption.dataset.kecamatan 
        : selectKecamatan.value;

      if (selectKecamatan.value === 'SEMUA' && selectedOption.dataset.kecamatan) {
        selectKecamatan.value = selectedOption.dataset.kecamatan;
      }

      checkOfficerUploadStatus(currentKec, val);
    }
  });

  async function checkOfficerUploadStatus(kec, name) {
    if (!kec || !name) return;
    try {
      const res = await fetch(`/api/check-status?kecamatan=${encodeURIComponent(kec)}&nama=${encodeURIComponent(name)}`);
      const json = await res.json();
      if (json.success && json.uploaded) {
        showToast(`PERINGATAN: Petugas "${name}" (${kec}) SUDAH PERNAH MENGUNGGAH SCREENSHOT! Setiap petugas hanya diperbolehkan upload 1 kali.`, 'danger');
        btnSubmitUpload.disabled = true;
        btnSubmitUpload.style.background = '#94a3b8';
        btnSubmitUpload.textContent = '⛔ Petugas Ini Sudah Upload (Maks 1x Submission)';
      } else {
        btnSubmitUpload.disabled = false;
        btnSubmitUpload.style.background = '';
        btnSubmitUpload.textContent = 'Kirim Bukti Screenshot';
      }
    } catch (err) {
      console.error('Failed to check status:', err);
    }
  }

  async function saveNewPetugas(kec, pos, name) {
    try {
      const res = await fetch('/api/petugas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kecamatan: kec, posisi: pos, nama: name })
      });
      const json = await res.json();
      if (json.success) {
        showToast(`Petugas "${name}" berhasil ditambahkan!`, 'success');
        masterPetugasList = json.data;
        updatePetugasDropdown(kec);
        selectPetugas.value = name;
        inputPosisi.value = pos;
        posisiBadge.textContent = `Posisi: ${pos}`;
        posisiBadge.classList.remove('hidden');
      }
    } catch (err) {
      showToast('Gagal menambahkan petugas baru', 'danger');
    }
  }

  // Helper setup dropzone handlers
  function setupDropzone(zoneEl, inputEl, listRef, renderFn) {
    ['dragenter', 'dragover'].forEach(eventName => {
      zoneEl.addEventListener(eventName, (e) => {
        e.preventDefault();
        zoneEl.classList.add('dragover');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      zoneEl.addEventListener(eventName, (e) => {
        e.preventDefault();
        zoneEl.classList.remove('dragover');
      }, false);
    });

    zoneEl.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt.files && dt.files.length > 0) {
        addFilesToList(Array.from(dt.files), listRef, renderFn);
      }
    });

    inputEl.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        addFilesToList(Array.from(e.target.files), listRef, renderFn);
      }
    });
  }

  async function addFilesToList(files, listRef, renderFn) {
    const images = files.filter(f => f.type.startsWith('image/'));
    if (images.length === 0) {
      showToast('Harap pilih file gambar (PNG, JPG, JPEG, WEBP)!', 'danger');
      return;
    }

    let added = 0;
    for (const file of images) {
      // 1. Check Original File Size (< 15 MB)
      const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
      if (file.size > MAX_BYTES) {
        const mb = (file.size / (1024 * 1024)).toFixed(1);
        showToast(`File "${file.name}" ditolak! Ukuran ${mb} MB melebihi batas 15 MB.`, 'danger');
        continue;
      }

      // 2. Check Orientation (Portrait: height >= width)
      try {
        const dims = await getImageDimensions(file);
        if (dims.height < dims.width) {
          showToast(`File "${file.name}" ditolak! Orientasi harus PORTRAIT (Tinggi ≥ Lebar). Ukuran: ${dims.width}x${dims.height}px.`, 'danger');
          continue;
        }
      } catch (err) {
        showToast(`Gagal membaca dimensi gambar "${file.name}".`, 'danger');
        continue;
      }

      // 3. Compress to Lightweight WebP (~30-60 KB)
      let fileToAdd = file;
      try {
        fileToAdd = await compressToLightweightWebP(file);
      } catch (err) {
        console.warn('WebP compression failed, using original file:', err);
      }

      // Avoid duplicates
      if (!listRef.some(f => f.name === fileToAdd.name && f.size === fileToAdd.size)) {
        listRef.push(fileToAdd);
        added++;
      }
    }

    if (added > 0) {
      renderFn();
    }
  }

  function compressToLightweightWebP(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);

        const MAX_WIDTH = 900;
        const MAX_HEIGHT = 1350;
        let width = img.naturalWidth;
        let height = img.naturalHeight;

        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }
        if (height > MAX_HEIGHT) {
          width = Math.round((width * MAX_HEIGHT) / height);
          height = MAX_HEIGHT;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (!blob) return resolve(file);
          const webpName = file.name.replace(/\.[^/.]+$/, "") + ".webp";
          const compressedFile = new File([blob], webpName, {
            type: 'image/webp',
            lastModified: Date.now()
          });
          console.log(`[WEBP COMPRESS] Original: ${(file.size / 1024).toFixed(1)} KB -> WebP: ${(compressedFile.size / 1024).toFixed(1)} KB`);
          resolve(compressedFile);
        }, 'image/webp', 0.65);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    });
  }

  function getImageDimensions(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const dimensions = { width: img.naturalWidth, height: img.naturalHeight };
        URL.revokeObjectURL(url);
        resolve(dimensions);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  }

  // Setup Dropzone 1 (Capaian)
  setupDropzone(dropzoneCapaian, inputFileCapaian, filesCapaianList, renderCapaianPreviews);

  function renderCapaianPreviews() {
    if (filesCapaianList.length === 0) {
      promptCapaian.classList.remove('hidden');
      containerCapaian.classList.add('hidden');
      gridCapaian.innerHTML = '';
      return;
    }
    promptCapaian.classList.add('hidden');
    containerCapaian.classList.remove('hidden');
    badgeCapaian.textContent = `${filesCapaianList.length} File Capaian`;

    gridCapaian.innerHTML = '';
    filesCapaianList.forEach((file, idx) => {
      gridCapaian.appendChild(createThumbCard(file, () => {
        filesCapaianList.splice(idx, 1);
        renderCapaianPreviews();
      }));
    });
  }

  btnRemoveCapaian.addEventListener('click', (e) => {
    e.stopPropagation();
    filesCapaianList = [];
    inputFileCapaian.value = '';
    renderCapaianPreviews();
  });

  // Setup Dropzone 2 (Hapus)
  setupDropzone(dropzoneHapus, inputFileHapus, filesHapusList, renderHapusPreviews);

  function renderHapusPreviews() {
    if (filesHapusList.length === 0) {
      promptHapus.classList.remove('hidden');
      containerHapus.classList.add('hidden');
      gridHapus.innerHTML = '';
      return;
    }
    promptHapus.classList.add('hidden');
    containerHapus.classList.remove('hidden');
    badgeHapus.textContent = `${filesHapusList.length} File Hapus`;

    gridHapus.innerHTML = '';
    filesHapusList.forEach((file, idx) => {
      gridHapus.appendChild(createThumbCard(file, () => {
        filesHapusList.splice(idx, 1);
        renderHapusPreviews();
      }));
    });
  }

  btnRemoveHapus.addEventListener('click', (e) => {
    e.stopPropagation();
    filesHapusList = [];
    inputFileHapus.value = '';
    renderHapusPreviews();
  });

  function createThumbCard(file, removeCb) {
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
    btnRemove.onclick = (e) => {
      e.stopPropagation();
      removeCb();
    };

    card.appendChild(img);
    card.appendChild(btnRemove);
    return card;
  }

  // Dual Dropzone Form Submission
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const selectedKec = selectKecamatan.value;
    const selectedPetugas = selectPetugas.value;

    if (!selectedKec || selectedKec === 'SEMUA') {
      showToast('Pilih Kecamatan Tugas terlebih dahulu!', 'danger');
      selectKecamatan.focus();
      return;
    }

    if (!selectedPetugas || selectedPetugas === '__ADD_NEW__') {
      showToast('Pilih Nama Petugas terlebih dahulu!', 'danger');
      selectPetugas.focus();
      return;
    }

    const totalFiles = filesCapaianList.length + filesHapusList.length;
    if (totalFiles === 0) {
      showToast('Pilih minimal 1 file gambar screenshot (Capaian atau Hapus)!', 'danger');
      return;
    }

    const formData = new FormData();
    formData.append('kecamatan', selectedKec);
    formData.append('nama', selectedPetugas);
    formData.append('posisi', inputPosisi.value || 'PPL Sensus');

    filesCapaianList.forEach(file => {
      formData.append('files_capaian', file);
    });

    filesHapusList.forEach(file => {
      formData.append('files_hapus', file);
    });

    btnSubmitUpload.disabled = true;
    btnSubmitUpload.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Mengirim ${totalFiles} Screenshot...`;

    try {
      const res = await fetch('/api/capaian', {
        method: 'POST',
        body: formData
      });
      const json = await res.json();

      if (json.success) {
        showToast(json.message, 'success');
        
        uploadForm.reset();
        filesCapaianList = [];
        filesHapusList = [];
        inputFileCapaian.value = '';
        inputFileHapus.value = '';
        renderCapaianPreviews();
        renderHapusPreviews();

        posisiBadge.classList.add('hidden');
        selectPetugas.disabled = true;
        selectPetugas.innerHTML = '<option value="" disabled selected>Cari Nama Petugas...</option>';

        fetchMasterData();
      } else {
        showToast(json.message || 'Gagal mengunggah screenshot', 'danger');
      }
    } catch (err) {
      console.error('Error uploading:', err);
      showToast('Terjadi kesalahan server saat mengunggah.', 'danger');
    } finally {
      btnSubmitUpload.disabled = false;
      btnSubmitUpload.textContent = 'Kirim Bukti Screenshot';
    }
  });

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

  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
  }
});
