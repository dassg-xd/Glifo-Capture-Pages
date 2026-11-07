# Glifo Captura en GitHub Pages

Página pública para recolectar trazos de letras entre todos los grupos. No necesita cuentas: cada navegador entra de forma anónima. Los datos se guardan en Firebase Realtime Database (plan gratuito).

## Qué hay en este paquete

| Archivo | Para qué sirve | ¿Se sube a GitHub? |
|---|---|---|
| `docs/index.html` | La página | Sí |
| `docs/app.js` | La lógica (dibujo, guardado, tiempo real) | Sí |
| `docs/guia.js` | Los patrones de la guía de dibujo | Sí |
| `docs/firebase-config.js` | Los datos de tu proyecto de Firebase | Sí, después de llenarlo |
| `database.rules.json` | Reglas de seguridad de la base | **No.** Se pega en la consola de Firebase |

## 1. Crear la base en Firebase (unos 10 minutos)

1. Entra a <https://console.firebase.google.com> con tu cuenta de Google y pulsa **Agregar proyecto**. Nombre sugerido: `glifo-captura`. Puedes desactivar Google Analytics.
2. En el menú **Compilación → Realtime Database**, pulsa **Crear base de datos**. Elige la ubicación `us-central1` y el **modo bloqueado**.
3. En la pestaña **Reglas** de la base, borra lo que haya y pega el contenido de `database.rules.json`. Reemplaza las **3** apariciones de `CORREO_DEL_DIRECTOR` por el correo de Google con el que vas a entrar como director, y pulsa **Publicar**.
4. En **Compilación → Authentication**, pulsa **Comenzar**. En **Método de acceso**, habilita **Anónimo** y **Google**.
5. En **Authentication → Configuración → Dominios autorizados**, agrega `dassg-xd.github.io`.
6. En el engranaje **Configuración del proyecto → General → Tus apps**, pulsa el ícono web `</>`, registra la app con el nombre `glifo-captura` (sin Hosting) y copia el bloque `firebaseConfig`. Si no trae `databaseURL`, cópiala de la parte de arriba de la página de Realtime Database.

## 2. Publicar en GitHub Pages

1. En el repositorio **dassg-xd/Glifo**, pulsa **Add file → Upload files** y arrastra la carpeta `docs` completa. Haz commit en `main`.
2. Abre `docs/firebase-config.js` en GitHub, pulsa el lápiz para editarlo, reemplaza los valores `PEGA_AQUI...` por los que copiaste en el paso 1.6 y haz commit.
3. Ve a **Settings → Pages**. En **Source**, elige **Deploy from a branch**, luego la rama **main** y la carpeta **/docs**, y pulsa **Save**.
4. En uno o dos minutos la página queda en <https://dassg-xd.github.io/Glifo/>. Ese es el enlace para compartir con el curso.

## 3. Probar

- Abre el enlace: el indicador de arriba debe decir **Dataset compartido**.
- Escribe un nombre y un grupo, dibuja una letra y guárdala.
- Ábrelo en otro dispositivo: debe verse la muestra y, en **En vivo**, la otra persona.
- Pulsa **Entrar como director** e inicia sesión con el correo que pusiste en las reglas. El indicador cambia a **director** y aparece la ✕ en todas las muestras.
- Como director aparece abajo a la derecha la sección **Administración** con el botón **Borrar todo el dataset** (ver más abajo).

## Cómo quedan los permisos

Las reglas de Firebase hacen cumplir esto en el servidor, no solo en la pantalla:

- No se acepta una muestra sin nombre (2 a 40 caracteres) y grupo (1 a 30), ni con menos de 8 puntos.
- Cada navegador solo puede borrar las muestras que guardó él mismo.
- Solo el correo del director puede borrar cualquier muestra.
- Solo el director ve y puede usar **Borrar todo el dataset**.
- Nadie puede modificar una muestra ya guardada; solo borrarla y volver a dibujarla.

Un detalle importante: la identidad anónima vive en el navegador. Si alguien borra los datos del navegador o cambia de dispositivo, ya no puede borrar lo que guardó antes. En ese caso, el director puede borrarlo.

## Guía de dibujo

Junto al recuadro **Dibuja** está el botón **Guía de dibujo**. Abre una franja encima del lienzo que muestra cómo se traza la letra actual: la letra completa en gris y, encima, cada trazo se dibuja solo y en orden, con su número (1, 2, 3) donde empieza. **Repetir** vuelve a mostrar la animación.

- Si cambias de letra con la guía abierta, se actualiza sola.
- Se puede dibujar en el lienzo con la guía abierta; no lo tapa.
- Se cierra con la ✕, con el mismo botón, con `Esc` (sin borrar lo que hay en el lienzo) o con un clic fuera de ella.

Los patrones están en `docs/guia.js`, en el mismo espacio de 0 a 1000 y sobre las mismas líneas guía del lienzo. Para cambiar cómo se enseña una letra, se edita su lista de trazos (cada trazo es un camino SVG, en el orden en que se dibuja).

## Borrar todo el dataset (director)

Sirve para empezar un dataset nuevo. Solo aparece con la sesión de director iniciada.

1. Pulsa **Borrar todo el dataset**. Se abre un aviso con el número de muestras que se van a perder.
2. Si quieres conservarlas, pulsa **Descargar una copia de respaldo primero**: baja el JSON de todos los grupos (el mismo formato de «Descargar dataset .json»), sin importar el filtro de exportación.
3. Escribe `BORRAR` en la casilla. Hasta entonces el botón rojo no se activa; **Cancelar** o `Esc` cierran sin borrar nada.

El borrado no se puede deshacer. Se hace por lotes de 200 muestras y muestra el avance. Si se corta (conexión o permisos), lo ya borrado no vuelve, y al intentarlo otra vez sigue con las que quedan.

No hace falta cambiar las reglas: las actuales ya permiten que el director borre cualquier muestra.

## Límites del plan gratuito

El plan gratuito (Spark) permite **100 conexiones simultáneas**, 1 GB guardado y 10 GB de descarga al mes. Un dataset de 810 letras ocupa unos pocos MB, así que alcanza de sobra para el curso.

## Formato del JSON exportado

Es el mismo que el de la versión anterior:

```json
{ "letra": "a", "autor": "santiago", "grupo": "Grupo 2", "espacio": 1000,
  "trazos": [ [[412.3, 455.1, 0], [410.8, 458.0, 16]], [[...]] ] }
```

Cada trazo es una lista de puntos `[x, y, t_ms]`, con `x` e `y` entre 0 y 1000 (la `y` crece hacia abajo).
