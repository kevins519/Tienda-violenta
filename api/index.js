const OWNER = 'kevins519';
const REPO = 'Tienda-violenta';

async function fetchFile(path, token) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Vercel-Serverless-Function'
    }
  });
  if (res.status === 404) return { sha: '', content: null };
  if (!res.ok) throw new Error(`Fetch error ${path}: ${res.status}`);
  const json = await res.json();
  const decoded = Buffer.from(json.content, 'base64').toString('utf-8');
  return { sha: json.sha, content: decoded };
}

async function updateFile(path, contentStr, message, sha, token) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const body = {
    message,
    content: Buffer.from(contentStr, 'utf-8').toString('base64'),
    branch: 'main'
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Vercel-Serverless-Function'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Update error ${path}: ${res.status}`);
  return await res.json();
}

async function getReleases(token) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Vercel-Serverless-Function'
    }
  });
  if (!res.ok) return [];
  return await res.json();
}

async function deleteRelease(releaseId, token) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}`;
  await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Vercel-Serverless-Function'
    }
  });
}

async function createReleaseAndUploadAsset(tagName, releaseName, bodyText, fileName, fileBase64, token) {
  const relUrl = `https://api.github.com/repos/${OWNER}/${REPO}/releases`;
  const relRes = await fetch(relUrl, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Vercel-Serverless-Function'
    },
    body: JSON.stringify({
      tag_name: tagName,
      name: releaseName,
      body: bodyText || '',
      draft: false,
      prerelease: false
    })
  });
  if (!relRes.ok) throw new Error(`Release creation error: ${relRes.status}`);
  const relData = await relRes.json();
  const uploadUrlTemplate = relData.upload_url.replace(/\{.*?\} $/, '');
  const finalUploadUrl = `${uploadUrlTemplate}?name=${encodeURIComponent(fileName)}`;
  const buffer = Buffer.from(fileBase64, 'base64');
  const upRes = await fetch(finalUploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/octet-stream',
      'User-Agent': 'Vercel-Serverless-Function'
    },
    body: buffer
  });
  if (!upRes.ok) throw new Error(`Asset upload error: ${upRes.status}`);
  const assetData = await upRes.json();
  return assetData.browser_download_url;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const token = process.env.MI_TOKEN_SECRETO;
  if (!token) {
    return res.status(500).json({ success: false, error: 'Token no configurado' });
  }

  const { accion, ...params } = req.body || {};

  try {
    switch (accion) {
      case 'incrementarDescarga': {
        const { archivoObj } = params;
        const { sha, content } = await fetchFile('archivos.json', token);
        let lista = content ? JSON.parse(content) : [];
        let encontrado = false;
        for (const item of lista) {
          if (
            String(item.nombre).toLowerCase() === String(archivoObj.nombre).toLowerCase() &&
            String(item.categoria).toLowerCase() === String(archivoObj.categoria).toLowerCase()
          ) {
            item.descargas = (Number(item.descargas) || 0) + 1;
            encontrado = true;
            break;
          }
        }
        if (encontrado) {
          await updateFile('archivos.json', JSON.stringify(lista, null, 2), `Incrementar descarga de ${archivoObj.nombre}`, sha, token);
        }
        return res.status(200).json({ success: true });
      }

      case 'enviarCalificacion': {
        const { archivoObj, puntajeEstrellas, usuarioId } = params;
        const keyItem = `${archivoObj.nombre}_${archivoObj.autor}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        const { sha, content } = await fetchFile('calificaciones.json', token);
        let map = content ? JSON.parse(content) : {};
        if (!map[keyItem]) {
          map[keyItem] = {
            nombreArchivo: archivoObj.nombre,
            autorArchivo: archivoObj.autor,
            promedio: 0,
            totalVotos: 0,
            evaluaciones: {}
          };
        }
        const user = usuarioId || 'invitado';
        map[keyItem].evaluaciones[user] = Number(puntajeEstrellas);
        let suma = 0;
        let count = 0;
        for (const k in map[keyItem].evaluaciones) {
          suma += Number(map[keyItem].evaluaciones[k]);
          count++;
        }
        map[keyItem].promedio = count > 0 ? Math.floor((suma / count) * 10) / 10 : 0;
        map[keyItem].totalVotos = count;
        await updateFile('calificaciones.json', JSON.stringify(map, null, 2), `Calificación para ${archivoObj.nombre} (${puntajeEstrellas} estrellas)`, sha, token);
        return res.status(200).json({ success: true });
      }

      case 'enviarComentario': {
        const { archivoObj, textoComentario, usuarioId } = params;
        const keyItem = `${archivoObj.nombre}_${archivoObj.autor}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        const { sha, content } = await fetchFile('comentarios.json', token);
        let map = content ? JSON.parse(content) : {};
        if (!map[keyItem]) {
          map[keyItem] = {
            nombreArchivo: archivoObj.nombre,
            autorArchivo: archivoObj.autor,
            listaComentarios: []
          };
        }
        const user = usuarioId || 'invitado';
        const nowStr = new Date().toLocaleString('es-ES');
        let encontrado = false;
        for (const com of map[keyItem].listaComentarios) {
          if (String(com.autor).toLowerCase() === String(user).toLowerCase()) {
            com.texto = textoComentario;
            com.fecha = `${nowStr} (Editado)`;
            encontrado = true;
            break;
          }
        }
        if (!encontrado) {
          map[keyItem].listaComentarios.unshift({
            autor: user,
            texto: textoComentario,
            fecha: nowStr
          });
        }
        await updateFile('comentarios.json', JSON.stringify(map, null, 2), `Actualizar/Nuevo comentario de ${user} en ${archivoObj.nombre}`, sha, token);
        return res.status(200).json({ success: true });
      }

      case 'eliminarComplemento': {
        const { archivoObj } = params;
        const { sha, content } = await fetchFile('archivos.json', token);
        let lista = content ? JSON.parse(content) : [];
        const nuevaLista = lista.filter(
          item =>
            !(
              String(item.nombre).toLowerCase() === String(archivoObj.nombre).toLowerCase() &&
              String(item.categoria).toLowerCase() === String(archivoObj.categoria).toLowerCase()
            )
        );
        await updateFile('archivos.json', JSON.stringify(nuevaLista, null, 2), `Eliminar ${archivoObj.nombre} de archivos.json`, sha, token);
        const releases = await getReleases(token);
        const expectedName = `Release ${archivoObj.nombre}`;
        for (const rel of releases) {
          if (rel.name === expectedName || rel.tag_name) {
            await deleteRelease(rel.id, token);
            break;
          }
        }
        return res.status(200).json({ success: true });
      }

      case 'eliminarTodoDelCreador': {
        const { nombreCreadorTarget } = params;
        const targetLower = String(nombreCreadorTarget).toLowerCase();

        const pFile = await fetchFile('Perfiles.txt', token);
        if (pFile.content) {
          const lines = pFile.content.split(/\r?\n/);
          const newLines = lines.filter(line => {
            if (!line.startsWith('#') && line.includes('|')) {
              const parts = line.split('|').map(s => s.trim());
              if (parts[2] && parts[2].toLowerCase() === targetLower) return false;
            }
            return true;
          });
          await updateFile('Perfiles.txt', newLines.join('\n'), `Eliminar creador ${nombreCreadorTarget} de Perfiles.txt`, pFile.sha, token);
        }

        const aFile = await fetchFile('archivos.json', token);
        let archivosAEliminar = [];
        if (aFile.content) {
          const lista = JSON.parse(aFile.content);
          const nuevaLista = [];
          for (const item of lista) {
            if (String(item.autor || '').toLowerCase() === targetLower) {
              archivosAEliminar.push(item);
            } else {
              nuevaLista.push(item);
            }
          }
          await updateFile('archivos.json', JSON.stringify(nuevaLista, null, 2), `Eliminación masiva de archivos del creador: ${nombreCreadorTarget}`, aFile.sha, token);
        }

        const releases = await getReleases(token);
        for (const arch of archivosAEliminar) {
          const expectedName = `Release ${arch.nombre}`;
          for (const rel of releases) {
            if (rel.name === expectedName || (rel.tag_name && rel.name.includes(arch.nombre))) {
              await deleteRelease(rel.id, token);
              break;
            }
          }
        }

        const cFile = await fetchFile('calificaciones.json', token);
        if (cFile.content) {
          let map = JSON.parse(cFile.content);
          let changed = false;
          for (const key in map) {
            if (String(map[key].autorArchivo || '').toLowerCase() === targetLower) {
              delete map[key];
              changed = true;
            }
          }
          if (changed) {
            await updateFile('calificaciones.json', JSON.stringify(map, null, 2), `Eliminar calificaciones del creador: ${nombreCreadorTarget}`, cFile.sha, token);
          }
        }

        const comFile = await fetchFile('comentarios.json', token);
        if (comFile.content) {
          let map = JSON.parse(comFile.content);
          let changed = false;
          for (const key in map) {
            if (String(map[key].autorArchivo || '').toLowerCase() === targetLower) {
              delete map[key];
              changed = true;
            }
          }
          if (changed) {
            await updateFile('comentarios.json', JSON.stringify(map, null, 2), `Eliminar comentarios de las obras del creador: ${nombreCreadorTarget}`, comFile.sha, token);
          }
        }

        const anFile = await fetchFile('anuncios.json', token);
        if (anFile.content) {
          let map = JSON.parse(anFile.content);
          let changed = false;
          for (const key in map) {
            if (String(map[key].autorAnuncio || '').toLowerCase() === targetLower) {
              delete map[key];
              changed = true;
            }
          }
          if (changed) {
            await updateFile('anuncios.json', JSON.stringify(map, null, 2), `Eliminar anuncios del creador: ${nombreCreadorTarget}`, anFile.sha, token);
          }
        }

        return res.status(200).json({ success: true });
      }

      case 'eliminarCalificacionesYComentarios': {
        const { archivoObj } = params;
        const keyItem = `${archivoObj.nombre}_${archivoObj.autor}`.replace(/[^a-zA-Z0-9_-]/g, '_');

        const cFile = await fetchFile('calificaciones.json', token);
        if (cFile.content) {
          let map = JSON.parse(cFile.content);
          if (map[keyItem]) {
            delete map[keyItem];
            await updateFile('calificaciones.json', JSON.stringify(map, null, 2), `Eliminar calificaciones de ${archivoObj.nombre}`, cFile.sha, token);
          }
        }

        const comFile = await fetchFile('comentarios.json', token);
        if (comFile.content) {
          let map = JSON.parse(comFile.content);
          if (map[keyItem]) {
            delete map[keyItem];
            await updateFile('comentarios.json', JSON.stringify(map, null, 2), `Eliminar comentarios de ${archivoObj.nombre}`, comFile.sha, token);
          }
        }

        return res.status(200).json({ success: true });
      }

      case 'eliminarComentario': {
        const { archivoObj, autorComentarioTarget } = params;
        const keyItem = `${archivoObj.nombre}_${archivoObj.autor}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        const { sha, content } = await fetchFile('comentarios.json', token);
        if (content) {
          let map = JSON.parse(content);
          if (map[keyItem] && map[keyItem].listaComentarios) {
            map[keyItem].listaComentarios = map[keyItem].listaComentarios.filter(
              c => String(c.autor).toLowerCase() !== String(autorComentarioTarget).toLowerCase()
            );
            await updateFile('comentarios.json', JSON.stringify(map, null, 2), `Eliminar comentario de ${autorComentarioTarget}`, sha, token);
          }
        }
        return res.status(200).json({ success: true });
      }

      case 'enviarNotificacion': {
        const { mensajeTexto, autorPublico } = params;
        const { sha, content } = await fetchFile('notificaciones.json', token);
        let lista = content ? JSON.parse(content) : [];
        lista.unshift({
          mensaje: mensajeTexto,
          autor: autorPublico || 'Admin',
          fecha: new Date().toLocaleString('es-ES')
        });
        await updateFile('notificaciones.json', JSON.stringify(lista, null, 2), `Nueva notificación de ${autorPublico || 'Admin'}`, sha, token);
        return res.status(200).json({ success: true });
      }

      case 'eliminarNotificacion': {
        const { indexItem } = params;
        const { sha, content } = await fetchFile('notificaciones.json', token);
        if (content) {
          let lista = JSON.parse(content);
          lista.splice(indexItem, 1);
          await updateFile('notificaciones.json', JSON.stringify(lista, null, 2), `Eliminar notificación index ${indexItem}`, sha, token);
        }
        return res.status(200).json({ success: true });
      }

      case 'limpiarTodasNotificaciones': {
        const { sha } = await fetchFile('notificaciones.json', token);
        await updateFile('notificaciones.json', JSON.stringify([], null, 2), 'Limpiar todas las notificaciones', sha, token);
        return res.status(200).json({ success: true });
      }

      case 'subirAnuncio': {
        const { nombreCategoria, textoAnuncio, perfilActual, autorPublico } = params;
        const autorKey = perfilActual || autorPublico || 'Admin';
        const keyItem = `${nombreCategoria}_${autorKey}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        const { sha, content } = await fetchFile('anuncios.json', token);
        let map = content ? JSON.parse(content) : {};
        map[keyItem] = {
          categoria: nombreCategoria,
          autorAnuncio: autorKey,
          texto: textoAnuncio,
          fecha: new Date().toLocaleString('es-ES')
        };
        await updateFile('anuncios.json', JSON.stringify(map, null, 2), `Actualizar anuncio de ${nombreCategoria} para ${autorKey}`, sha, token);
        return res.status(200).json({ success: true });
      }

      case 'subirActualizacion': {
        const { numeroVersion, cambiosTexto, fileName, fileBase64 } = params;
        const tagName = `v${numeroVersion}`;
        const downloadUrl = await createReleaseAndUploadAsset(
          tagName,
          `Actualización Tienda v${numeroVersion}`,
          cambiosTexto,
          fileName,
          fileBase64,
          token
        );
        const { sha } = await fetchFile('actualizacion.json', token);
        const infoActualizacion = {
          version: numeroVersion,
          cambios: cambiosTexto,
          url: downloadUrl,
          fecha: Math.floor(Date.now() / 1000)
        };
        await updateFile('actualizacion.json', JSON.stringify(infoActualizacion, null, 2), `Publicar actualización v${numeroVersion}`, sha, token);
        return res.status(200).json({ success: true, downloadUrl });
      }

      case 'agregarPerfilRapido': {
        const { rolNuevo, usuarioNuevo, nombreNuevo, nombreOriginalTarget, esEdicion } = params;
        const { sha, content } = await fetchFile('Perfiles.txt', token);
        const lines = content ? content.split(/\r?\n/) : [];
        let newLines = [];
        let encontrado = false;
        for (const line of lines) {
          let omitir = false;
          if (!line.startsWith('#') && line.includes('|')) {
            const parts = line.split('|').map(s => s.trim());
            if (esEdicion && parts[2] && parts[2].toLowerCase() === String(nombreOriginalTarget).toLowerCase()) {
              newLines.push(`${rolNuevo} | ${usuarioNuevo} | ${nombreNuevo}`);
              encontrado = true;
              omitir = true;
            }
          }
          if (!omitir) newLines.push(line);
        }
        if (!esEdicion || !encontrado) {
          newLines.push(`${rolNuevo} | ${usuarioNuevo} | ${nombreNuevo}`);
        }
        const msg = esEdicion ? `Actualizar perfil de ${nombreNuevo}` : `Agregar perfil de ${nombreNuevo}`;
        await updateFile('Perfiles.txt', newLines.join('\n'), msg, sha, token);
        return res.status(200).json({ success: true });
      }

      case 'subirComplemento': {
        const {
          tipoCategoria,
          descripcion,
          tutorialUrl,
          esModificacion,
          nombreArchivoOriginal,
          fileName: paramFileName,
          fileBase64,
          perfilActual,
          autorPublico
        } = params;

        let downloadUrl = null;
        let fileName = nombreArchivoOriginal || paramFileName;

        if (fileBase64) {
          const tagName = `v${Date.now()}`;
          downloadUrl = await createReleaseAndUploadAsset(
            tagName,
            `Release ${fileName}`,
            descripcion,
            fileName,
            fileBase64,
            token
          );
        }

        const { sha, content } = await fetchFile('archivos.json', token);
        let lista = content ? JSON.parse(content) : [];

        if (esModificacion) {
          for (const item of lista) {
            if (
              String(item.nombre).toLowerCase() === String(nombreArchivoOriginal).toLowerCase() &&
              String(item.categoria).toLowerCase() === String(tipoCategoria).toLowerCase()
            ) {
              item.descripcion = descripcion;
              item.tutorial = tutorialUrl || '';
              item.fecha = Math.floor(Date.now() / 1000);
              if (downloadUrl) item.url = downloadUrl;
              break;
            }
          }
        } else {
          const autorDestino = perfilActual || autorPublico || 'Admin';
          lista.push({
            categoria: tipoCategoria,
            nombre: fileName,
            autor: autorDestino,
            descripcion: descripcion,
            tutorial: tutorialUrl || '',
            url: downloadUrl || '',
            fecha: Math.floor(Date.now() / 1000),
            descargas: 0
          });
        }

        const msg = esModificacion ? `Modificar ${fileName}` : `Añadir ${fileName}`;
        await updateFile('archivos.json', JSON.stringify(lista, null, 2), msg, sha, token);
        return res.status(200).json({ success: true, downloadUrl });
      }

      default:
        return res.status(400).json({ success: false, error: 'Accion no valida' });
    }
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}