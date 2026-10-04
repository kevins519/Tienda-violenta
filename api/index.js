export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { pathArchivo, contenidoNuevo, mensajeCommit } = req.body;
  const GITHUB_TOKEN = process.env.MI_TOKEN_SECRETO; 
  const REPO_OWNER_REPO = "kevins519/Tienda-violenta";

  try {
    const urlApi = `https://api.github.com/repos/${REPO_OWNER_REPO}/contents/${pathArchivo}`;

    const respuestaGet = await fetch(urlApi, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Vercel-Server'
      }
    });

    let shaArchivo = "";
    if (respuestaGet.ok) {
      const datosJson = await respuestaGet.json();
      shaArchivo = datosJson.sha;
    }

    const contenidoBase64 = Buffer.from(JSON.stringify(contenidoNuevo)).toString('base64');

    const respuestaPut = await fetch(urlApi, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Vercel-Server'
      },
      body: JSON.stringify({
        message: mensajeCommit || "Actualización vía Vercel",
        content: contenidoBase64,
        branch: "main",
        ...(shaArchivo && { sha: shaArchivo })
      })
    });

    if (!respuestaPut.ok) {
      const errorText = await respuestaPut.text();
      throw new Error(`Error de GitHub: ${errorText}`);
    }

    return res.status(200).json({ exito: true, mensaje: "¡Actualizado con éxito!" });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
