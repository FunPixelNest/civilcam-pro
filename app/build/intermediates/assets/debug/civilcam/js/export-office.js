// ============================================================
// EXCEL GENERATION
// ============================================================
async function generateExcel(photos, heading, prepBy) {
  if (!window.XLSX) { showToast('Excel library not loaded', 'danger'); return; }

  const wb = XLSX.utils.book_new();
  const now = new Date();

  // Sheet 1: Photo Log
  const logData = [
    ['', heading, '', '', '', '', ''],
    ['Project:', projectName, '', 'Prepared By:', prepBy, '', ''],
    ['Date:', now.toLocaleDateString('en-IN'), '', 'Total Photos:', photos.length, '', ''],
    [],
    ['S.No', 'Date', 'Time', 'Activity', 'Chainage', 'Side', 'Remarks', 'GPS Lat', 'GPS Lng']
  ];

  photos.forEach((p, i) => {
    logData.push([
      i + 1,
      p.displayDate,
      p.displayTime || p.time,
      p.activity,
      p.chainage || '',
      p.side || '',
      p.remarks || '',
      p.location?.lat || '',
      p.location?.lng || ''
    ]);
  });

  const ws1 = XLSX.utils.aoa_to_sheet(logData);
  // Column widths
  ws1['!cols'] = [{wch:6},{wch:12},{wch:10},{wch:22},{wch:12},{wch:12},{wch:32},{wch:12},{wch:12}];
  // Merge title row
  ws1['!merges'] = [{s:{r:0,c:1},e:{r:0,c:6}}];
  XLSX.utils.book_append_sheet(wb, ws1, 'Photo Log');

  // Sheet 2: Activity Summary
  const actMap = {};
  photos.forEach(p => { actMap[p.activity] = (actMap[p.activity] || 0) + 1; });
  const sumData = [
    ['Activity-wise Summary', '', ''],
    ['Project:', projectName, ''],
    [],
    ['Activity', 'Count', '% of Total']
  ];
  Object.entries(actMap).sort((a,b) => b[1]-a[1]).forEach(([act, count]) => {
    sumData.push([act, count, ((count / photos.length) * 100).toFixed(1) + '%']);
  });
  sumData.push([], ['TOTAL', photos.length, '100%']);
  const ws2 = XLSX.utils.aoa_to_sheet(sumData);
  ws2['!cols'] = [{wch:28},{wch:10},{wch:14}];
  XLSX.utils.book_append_sheet(wb, ws2, 'Activity Summary');

  // Sheet 3: Monthly Summary
  const monthMap = {};
  photos.forEach(p => { monthMap[p.monthLabel] = (monthMap[p.monthLabel] || 0) + 1; });
  const monData = [
    ['Monthly Summary', '', ''],
    ['Project:', projectName, ''],
    [],
    ['Month', 'Photos Taken']
  ];
  Object.entries(monthMap).forEach(([m, c]) => monData.push([m, c]));
  const ws3 = XLSX.utils.aoa_to_sheet(monData);
  ws3['!cols'] = [{wch:24},{wch:14}];
  XLSX.utils.book_append_sheet(wb, ws3, 'Monthly Summary');

  // Sheet 4: Quarter Summary
  const qMap = {};
  photos.forEach(p => { qMap[p.quarterLabel] = (qMap[p.quarterLabel] || 0) + 1; });
  const qData = [['Quarter', 'Photos Taken']];
  Object.entries(qMap).forEach(([q, c]) => qData.push([q, c]));
  const ws4 = XLSX.utils.aoa_to_sheet(qData);
  ws4['!cols'] = [{wch:18},{wch:14}];
  XLSX.utils.book_append_sheet(wb, ws4, 'Quarter Summary');

  const filename = `${projectName}_${heading}_${now.toISOString().split('T')[0]}.xlsx`;
  const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const b64 = XLSX.write(wb, {bookType: 'xlsx', type: 'base64'});
  const ok = await saveFile(`data:${mime};base64,${b64}`, filename, mime);
  savedMessage(ok, 'Excel file', mime);
}

// ============================================================
// WORD GENERATION
// ============================================================
async function generateWord(photos, heading, prepBy) {
  const now = new Date();

  // Group photos by activity for activity-wise template
  const actMap = {};
  photos.forEach(p => { if (!actMap[p.activity]) actMap[p.activity] = []; actMap[p.activity].push(p); });

  let photosHtml = '';

  if (currentTemplate === 'activity') {
    Object.entries(actMap).forEach(([activity, actPhotos]) => {
      photosHtml += `
      <h2 style="font-size:14pt;color:#b45309;border-bottom:2px solid #f59e0b;padding-bottom:4px;margin-top:20pt">${activity.toUpperCase()} (${actPhotos.length} Photos)</h2>
      <table width="100%" cellpadding="4" cellspacing="4" style="border-collapse:collapse">`;
      for (let i = 0; i < actPhotos.length; i += 2) {
        photosHtml += '<tr>';
        for (let j = 0; j < 2; j++) {
          const p = actPhotos[i + j];
          if (p) {
            photosHtml += `<td width="50%" valign="top" style="border:1px solid #334155;padding:6px">
              <img src="${p.imageData}" width="100%" style="display:block;max-height:180px;object-fit:cover">
              <div style="background:#1e293b;padding:6px;font-size:9pt">
                <span style="color:#f59e0b;font-weight:bold">${p.activity}</span><br>
                ${(p.chainage || p.side) ? `<span style="color:#f1f5f9">${siteLabel(p.chainage, p.side)}</span><br>` : ''}
                <span style="color:#94a3b8">${p.displayDate} ${p.displayTime}</span><br>
                ${p.remarks ? `<span style="color:#f1f5f9">${p.remarks}</span>` : ''}
              </div>
            </td>`;
          } else {
            photosHtml += '<td width="50%"></td>';
          }
        }
        photosHtml += '</tr>';
      }
      photosHtml += '</table>';
    });
  } else {
    // Grid or default: 2 per row table
    photosHtml += `<table width="100%" cellpadding="4" cellspacing="4" style="border-collapse:collapse">`;
    for (let i = 0; i < photos.length; i += 2) {
      photosHtml += '<tr>';
      for (let j = 0; j < 2; j++) {
        const p = photos[i + j];
        if (p) {
          photosHtml += `<td width="50%" valign="top" style="border:1px solid #e2e8f0;padding:6px">
            <img src="${p.imageData}" width="100%" style="display:block;max-height:200px;object-fit:cover">
            <table width="100%" style="font-size:8pt;margin-top:4px;border-collapse:collapse">
              <tr><td style="color:#6b7280;width:90px"><b>Activity:</b></td><td style="color:#1e293b">${p.activity}</td></tr>
              <tr><td style="color:#6b7280"><b>Chainage:</b></td><td>${p.chainage || '-'}</td></tr>
              <tr><td style="color:#6b7280"><b>Side:</b></td><td>${p.side || '-'}</td></tr>
              <tr><td style="color:#6b7280"><b>Date/Time:</b></td><td>${p.displayDate} ${p.displayTime}</td></tr>
              ${p.location ? `<tr><td style="color:#6b7280"><b>GPS:</b></td><td>${p.location.lat}°N, ${p.location.lng}°E</td></tr>` : ''}
              ${p.remarks ? `<tr><td style="color:#6b7280"><b>Remarks:</b></td><td>${p.remarks}</td></tr>` : ''}
            </table>
          </td>`;
        } else {
          photosHtml += '<td width="50%"></td>';
        }
      }
      photosHtml += '</tr>';
    }
    photosHtml += '</table>';
  }

  const html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; color: #1e293b; margin: 0; }
  @page { margin: 2cm; }
  h1 { font-size: 20pt; color: #92400e; margin: 0 0 6pt; }
  h2 { page-break-before: auto; }
  .cover-table td { vertical-align: top; padding: 4px 8px; }
  .info-row { font-size: 10pt; color: #4b5563; }
  .divider { border-top: 3px solid #f59e0b; margin: 12pt 0; }
</style>
</head>
<body>
<!-- Cover Header -->
<div style="background:#0f172a;color:#f59e0b;padding:20pt 16pt;margin:-2cm -2cm 0;text-align:center">
  <h1 style="color:#f59e0b;font-size:22pt;margin:0">${projectName}</h1>
  <p style="color:#94a3b8;font-size:13pt;margin:6pt 0 0">${heading}</p>
</div>

<table width="100%" style="margin-top:12pt;margin-bottom:12pt;font-size:10pt;border-collapse:collapse">
  <tr>
    <td width="50%" style="padding:4px 8px"><b>Prepared By:</b> ${prepBy}</td>
    <td width="50%" style="padding:4px 8px"><b>Date:</b> ${now.toLocaleDateString('en-IN')}</td>
  </tr>
  <tr>
    <td style="padding:4px 8px"><b>Total Photos:</b> ${photos.length}</td>
    <td style="padding:4px 8px"><b>Generated:</b> ${now.toLocaleString('en-IN')}</td>
  </tr>
</table>
<hr style="border-top:2px solid #f59e0b;margin:0 0 16pt">

${photosHtml}

<p style="margin-top:24pt;font-size:8pt;color:#9ca3af;text-align:center">
Generated by CivilCam Pro | ${now.toLocaleString('en-IN')}
</p>
</body></html>`;

  const blob = new Blob(['﻿', html], {type:'application/msword'});
  const filename = `${projectName}_${heading}_${now.toISOString().split('T')[0]}.doc`;
  const ok = await saveFile(blob, filename, 'application/msword');
  savedMessage(ok, 'Word document', 'application/msword');
}

