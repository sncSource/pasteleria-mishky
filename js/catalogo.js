// =============================================================
// Pastelería Mishky · Catálogo dinámico (v2)
// - Carga data/productos.json con fetch y valida cada producto
// - Filtros por categoría + buscador + orden + ocultar agotados
// - Contadores dinámicos, hash en la URL, modal <dialog>
// - Imágenes responsivas (srcset/sizes) con carga diferida
// - Tarjetas "fantasma", estados de error y botón Reintentar
// - v3: filtros en la URL (URLSearchParams) + «Limpiar filtros»,
//       modo «Comparar» (máx. 3) y «Volver arriba» (IntersectionObserver)
// =============================================================

const RUTA_DATOS = "data/productos.json";
const SIN_IMAGEN = "img/sin-imagen.jpg";
const TODAS = "Todas";

// --- Configuración de imágenes responsivas ---------------------
// Si aún NO creó las carpetas img/productos/300w y /600w, ponga
// USAR_SRCSET en false (o créelas: la página igual funciona porque
// hay un respaldo automático a la imagen original de 900 px).
const USAR_SRCSET = true;
const ANCHOS_REDUCIDOS = [300, 600]; // carpetas: img/productos/300w/, 600w/
const ANCHO_ORIGINAL = 900; // la foto original sigue en img/productos/
const SIZES_MODAL = "(max-width: 700px) calc(100vw - 2rem), 460px";

const CANTIDAD_FANTASMAS = 8;

// --- Configuración v3 -------------------------------------------
const ORDEN_DEFECTO = "precio-asc";
const MAX_LONGITUD_BUSQUEDA = 80; // recorta valores absurdos que vengan en ?q=
const MAX_COMPARAR = 3; // máximo de productos en la comparación
const MIN_COMPARAR = 2; // mínimo para habilitar «Ver comparativa» (ponga 1 si lo desea)
const MARGEN_CABECERA = 80; // px de la cabecera fija (para el IntersectionObserver)
const EXTENSIONES_VALIDAS = /\.(?:jpe?g|png|webp|avif|gif|svg)$/i;

// --- Referencias al DOM ---------------------------------------
const contControles = document.querySelector("#controles");
const campoBuscador = document.querySelector("#buscador");
const campoOrden = document.querySelector("#orden");
const casillaAgotados = document.querySelector("#ocultar-agotados");
const contFiltros = document.querySelector("#filtros");
const grilla = document.querySelector("#grilla");
const estado = document.querySelector("#estado");
const aviso = document.querySelector("#aviso");
const btnReintentar = document.querySelector("#reintentar");
const plantilla = document.querySelector("#tpl-producto");
const btnLimpiar = document.querySelector("#limpiar-filtros");
const seccionCatalogo = document.querySelector("#catalogo");

// Reto 2: barra, comparativa y botón «volver arriba»
const barra = document.querySelector("#barra-comparar");
const barraContador = document.querySelector("#barra-contador");
const barraLista = document.querySelector("#barra-lista");
const btnVaciar = document.querySelector("#barra-vaciar");
const btnVer = document.querySelector("#barra-ver");
const dlgComparar = document.querySelector("#modal-comparar");
const contTabla = document.querySelector("#comparar-tabla");
const btnCompararCerrar = document.querySelector("#comparar-cerrar");
const btnCompararCerrarPie = document.querySelector("#comparar-cerrar-pie");
const btnArriba = document.querySelector("#volver-arriba");

const modal = document.querySelector("#modal");
const modalImg = document.querySelector("#modal-img");
const modalCategoria = document.querySelector("#modal-categoria");
const modalTitulo = document.querySelector("#modal-titulo");
const modalDescripcion = document.querySelector("#modal-descripcion");
const modalPrecio = document.querySelector("#modal-precio");
const modalStock = document.querySelector("#modal-stock");
const modalPorciones = document.querySelector("#modal-porciones");
const modalCerrar = document.querySelector("#modal-cerrar");
const modalCerrarPie = document.querySelector("#modal-cerrar-pie");

// --- Estado de la aplicación ----------------------------------
let productos = []; // solo productos válidos
let productosPorId = new Map();
let categorias = [TODAS];
let categoriaActiva = TODAS;
let busqueda = "";
let orden = "precio-asc";
let ocultarAgotados = false;
let cargando = false;
let tarjetaOrigen = null; // tarjeta que abrió el modal (para devolver el foco)
let temporizadorBusqueda = null;
let firmaGrilla = null; // ids pintados en #grilla: evita re-renderizar lo mismo
let seleccion = []; // ids de productos a comparar (en orden de selección)
let temporizadorLimite = null;

// Formato de moneda peruana: S/ 89.90
const soles = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" });

// Minúsculas y sin tildes: "Lúcuma" coincide con "lucuma" y con "LÚCUMA"
const normalizar = (texto) =>
  String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

// Comparadores para sort()
const COMPARADORES = {
  "precio-asc": (a, b) => a.precio - b.precio || a.nombre.localeCompare(b.nombre, "es"),
  "precio-desc": (a, b) => b.precio - a.precio || a.nombre.localeCompare(b.nombre, "es"),
  "nombre-asc": (a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }),
};

// =============================================================
// 1. Errores con mensaje para el usuario
// =============================================================
class ErrorCatalogo extends Error {
  constructor(tipo, mensajeUsuario, causa) {
    super(mensajeUsuario);
    this.name = "ErrorCatalogo";
    this.tipo = tipo; // red | http | json | formato | vacio
    this.mensajeUsuario = mensajeUsuario;
    this.causa = causa;
  }
}

// =============================================================
// 2. Cargar los datos desde el archivo JSON
// =============================================================
async function cargarProductos() {
  let respuesta;
  try {
    // no-store: al pulsar «Reintentar» siempre se vuelve a leer el archivo
    respuesta = await fetch(RUTA_DATOS, { cache: "no-store" });
  } catch (causa) {
    throw new ErrorCatalogo(
      "red",
      "No se pudo conectar para leer el catálogo. Revise su conexión y verifique que abrió la página con Live Server.",
      causa,
    );
  }

  if (!respuesta.ok) {
    const mensaje =
      respuesta.status === 404
        ? "No se encontró el archivo del catálogo (error 404). Verifique que data/productos.json exista y no haya sido renombrado."
        : `El servidor respondió con un error (HTTP ${respuesta.status}) al pedir el catálogo.`;
    throw new ErrorCatalogo("http", mensaje, `HTTP ${respuesta.status} en ${RUTA_DATOS}`);
  }

  let datos;
  try {
    datos = await respuesta.json();
  } catch (causa) {
    throw new ErrorCatalogo(
      "json",
      "El archivo del catálogo está dañado (JSON inválido, por ejemplo una coma sobrante al final). Corríjalo y pulse «Reintentar».",
      causa,
    );
  }

  if (!Array.isArray(datos)) {
    throw new ErrorCatalogo(
      "formato",
      "El archivo del catálogo no tiene el formato esperado: debe contener un arreglo de productos.",
      "La raíz del JSON no es un arreglo",
    );
  }
  return datos;
}

// =============================================================
// 3. Validación de productos
// =============================================================
function validarProducto(p, idsVistos) {
  if (p === null || typeof p !== "object" || Array.isArray(p)) {
    return { motivos: ["el registro no es un objeto"] };
  }

  const motivos = [];

  if (typeof p.id !== "number" || !Number.isFinite(p.id)) motivos.push("id no numérico");
  else if (idsVistos.has(p.id)) motivos.push(`id duplicado (${p.id})`);

  if (typeof p.nombre !== "string" || p.nombre.trim() === "") motivos.push("nombre vacío");

  if (typeof p.precio !== "number" || !Number.isFinite(p.precio) || p.precio <= 0) {
    motivos.push("precio no es un número positivo");
  }

  if (typeof p.stock !== "number" || !Number.isInteger(p.stock) || p.stock < 0) {
    motivos.push("stock no es un entero ≥ 0");
  }

  if (typeof p.categoria !== "string" || p.categoria.trim() === "") {
    motivos.push("categoría vacía");
  }

  if (typeof p.imagen !== "string" || !EXTENSIONES_VALIDAS.test(p.imagen.trim())) {
    motivos.push("imagen sin extensión válida (.jpg, .jpeg, .png, .webp, .avif, .gif, .svg)");
  }

  if (motivos.length > 0) return { motivos };

  idsVistos.add(p.id);
  return {
    motivos,
    producto: {
      ...p,
      nombre: p.nombre.trim(),
      categoria: p.categoria.trim(),
      imagen: p.imagen.trim(),
      descripcion: typeof p.descripcion === "string" ? p.descripcion : "",
      porciones: Number.isFinite(p.porciones) ? p.porciones : 1,
      destacado: p.destacado === true,
    },
  };
}

function validarProductos(lista) {
  const idsVistos = new Set();
  const validos = [];
  const descartados = [];

  lista.forEach((p, indice) => {
    const resultado = validarProducto(p, idsVistos);
    if (resultado.producto) {
      validos.push(resultado.producto);
    } else {
      descartados.push({ posicion: indice + 1, id: p?.id, motivos: resultado.motivos, original: p });
    }
  });

  return { validos, descartados };
}

function reportarDescartados(descartados) {
  if (descartados.length === 0) return;

  console.groupCollapsed(`⚠ ${descartados.length} producto(s) descartado(s) por datos inválidos`);
  descartados.forEach((d) => {
    console.warn(`Registro n.º ${d.posicion} (id: ${d.id ?? "sin id"}): ${d.motivos.join("; ")}`, d.original);
  });
  console.groupEnd();

  const n = descartados.length;
  aviso.textContent = `Se omitieron ${n} ${n === 1 ? "producto" : "productos"} con datos inválidos (detalle en la consola).`;
  aviso.hidden = false;
}

// =============================================================
// 4. Filtros, búsqueda, orden y contadores
// =============================================================
function obtenerCategorias(lista) {
  // Set elimina repetidos y conserva el orden de aparición
  return [TODAS, ...new Set(lista.map((p) => p.categoria))];
}

// Se ejecuta UNA vez por carga: crea los botones (sin cifras definitivas)
function renderizarFiltros() {
  const fragmento = document.createDocumentFragment();

  categorias.forEach((cat) => {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "filtro";
    boton.dataset.categoria = cat;
    boton.textContent = `${cat} (0)`;
    boton.setAttribute("aria-pressed", String(cat === categoriaActiva));
    fragmento.append(boton);
  });

  contFiltros.replaceChildren(fragmento);
}

// Aplica buscador + ocultar agotados (base), luego categoría y orden.
function calcularVista() {
  const consulta = normalizar(busqueda);

  const base = productos.filter(
    (p) =>
      (consulta === "" || normalizar(p.nombre).includes(consulta)) &&
      (!ocultarAgotados || p.stock > 0),
  );

  // Conteo por categoría con buscador y stock ya aplicados
  const conteos = new Map([[TODAS, base.length]]);
  base.forEach((p) => conteos.set(p.categoria, (conteos.get(p.categoria) ?? 0) + 1));

  const visibles =
    categoriaActiva === TODAS ? base : base.filter((p) => p.categoria === categoriaActiva);

  // Se ordena una COPIA: la lista original no se altera
  const lista = [...visibles].sort(COMPARADORES[orden]);

  return { lista, conteos };
}

// Solo cambia el textContent de cada botón: no se vuelven a crear
function actualizarContadores(conteos) {
  contFiltros.querySelectorAll(".filtro").forEach((boton) => {
    const cat = boton.dataset.categoria;
    boton.textContent = `${cat} (${conteos.get(cat) ?? 0})`;
  });
}

function actualizarPresionados() {
  contFiltros.querySelectorAll(".filtro").forEach((boton) => {
    boton.setAttribute("aria-pressed", String(boton.dataset.categoria === categoriaActiva));
  });
}

// opciones.sincronizarURL = false se usa solo en la carga inicial, para no
// reescribir la URL que el usuario trajo (p. ej. un ancla como #contacto).
function actualizarVista({ sincronizarURL = true } = {}) {
  const { lista, conteos } = calcularVista();
  actualizarPresionados();
  actualizarContadores(conteos);
  renderizarCatalogo(lista);
  actualizarBotonLimpiar();
  if (sincronizarURL) sincronizarConURL();
}

// =============================================================
// 4b. Reto 1: filtros en la URL (URLSearchParams) + «Limpiar filtros»
//     ?q=flan&orden=precio-desc&agotados=1#Postres
//     (la categoría sigue viajando en el hash, como antes)
// =============================================================
function hayFiltrosActivos() {
  return (
    busqueda.trim() !== "" ||
    orden !== ORDEN_DEFECTO ||
    ocultarAgotados ||
    categoriaActiva !== TODAS
  );
}

function actualizarBotonLimpiar() {
  btnLimpiar.disabled = !hayFiltrosActivos();
}

// Lee y VALIDA los parámetros: nunca se confía en lo que venga en la URL.
// URLSearchParams ya decodifica (%20, +, tildes) y no lanza error con
// secuencias % inválidas; aquí se limpia y se acota el resultado.
function leerFiltrosDeURL() {
  const params = new URLSearchParams(location.search);

  const q = (params.get("q") ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "") // sin caracteres de control
    .trim()
    .slice(0, MAX_LONGITUD_BUSQUEDA);

  const ordenURL = params.get("orden");
  const agotados = params.get("agotados");

  return {
    q,
    orden: Object.hasOwn(COMPARADORES, ordenURL) ? ordenURL : ORDEN_DEFECTO,
    agotados: agotados === "1" || agotados === "true",
  };
}

// Estado (variables) -> controles del DOM
function volcarEstadoEnControles() {
  campoBuscador.value = busqueda;
  campoOrden.value = orden;
  casillaAgotados.checked = ocultarAgotados;
}

// Solo se escriben los valores distintos del defecto: URL corta y limpia.
function sincronizarConURL() {
  const params = new URLSearchParams();
  if (busqueda.trim() !== "") params.set("q", busqueda.trim());
  if (orden !== ORDEN_DEFECTO) params.set("orden", orden);
  if (ocultarAgotados) params.set("agotados", "1");

  const consulta = params.toString();
  const hash = categoriaActiva === TODAS ? "" : `#${encodeURIComponent(categoriaActiva)}`;
  const url = location.pathname + (consulta ? `?${consulta}` : "") + hash;

  // replaceState (no pushState): no llena el historial con cada tecla
  try {
    history.replaceState(null, "", url);
  } catch (error) {
    console.warn("No se pudo actualizar la URL:", error);
  }
}

function limpiarFiltros() {
  clearTimeout(temporizadorBusqueda);
  busqueda = "";
  orden = ORDEN_DEFECTO;
  ocultarAgotados = false;
  categoriaActiva = TODAS;

  volcarEstadoEnControles();
  actualizarVista(); // recalcula contadores, grilla, #estado y limpia la URL
  estado.textContent = `Filtros restablecidos. ${estado.textContent}`;

  // El botón queda deshabilitado: se devuelve el foco al buscador
  campoBuscador.focus({ preventScroll: true });
}

// =============================================================
// 5. Imágenes responsivas
// =============================================================
// img/productos/torta.jpg  ->  img/productos/300w/torta.jpg 300w, ...
function construirSrcset(ruta) {
  const corte = ruta.lastIndexOf("/");
  const carpeta = corte >= 0 ? ruta.slice(0, corte) : ".";
  const archivo = ruta.slice(corte + 1);

  const reducidas = ANCHOS_REDUCIDOS.map((ancho) => `${carpeta}/${ancho}w/${archivo} ${ancho}w`);
  return [...reducidas, `${ruta} ${ANCHO_ORIGINAL}w`].join(", ");
}

function configurarImagen(img, producto, sizes) {
  // Los listeners se asignan ANTES de poner el src
  img.onload = () => img.classList.add("foto-cargada");

  img.onerror = () => {
    if (img.hasAttribute("srcset")) {
      // Falló una versión reducida: se usa la foto original
      img.removeAttribute("srcset");
      img.src = producto.imagen;
    } else if (!img.src.endsWith(SIN_IMAGEN)) {
      // Falló también la original: imagen de respaldo
      img.src = SIN_IMAGEN;
    }
  };

  img.alt = producto.nombre;
  if (sizes) img.sizes = sizes;

  if (USAR_SRCSET) img.srcset = construirSrcset(producto.imagen);
  else img.removeAttribute("srcset");

  img.src = producto.imagen; // respaldo para navegadores sin srcset
}

// =============================================================
// 6. Tarjetas y renderizado
// =============================================================
function crearTarjeta(p) {
  const nodo = document.importNode(plantilla.content, true);
  const tarjeta = nodo.querySelector(".tarjeta");
  const img = nodo.querySelector("img");
  const etiqueta = nodo.querySelector(".etiqueta");

  tarjeta.dataset.id = p.id;
  tarjeta.tabIndex = 0; // se puede abrir con teclado (Enter / Espacio)
  tarjeta.setAttribute("aria-haspopup", "dialog");

  configurarImagen(img, p);

  nodo.querySelector(".tarjeta__categoria").textContent = p.categoria;
  nodo.querySelector(".tarjeta__nombre").textContent = p.nombre;
  nodo.querySelector(".tarjeta__descripcion").textContent = p.descripcion;
  nodo.querySelector(".tarjeta__precio").textContent = soles.format(p.precio);
  nodo.querySelector(".tarjeta__porciones").textContent =
    p.porciones > 1 ? `${p.porciones} porciones` : "1 unidad";

  const btnComparar = nodo.querySelector(".tarjeta__comparar");
  btnComparar.setAttribute("aria-label", `Comparar ${p.nombre}`);
  btnComparar.setAttribute("aria-pressed", String(seleccion.includes(p.id)));

  if (p.stock === 0) {
    etiqueta.textContent = "Agotado";
    etiqueta.classList.add("etiqueta--agotado");
    etiqueta.hidden = false;
    tarjeta.classList.add("tarjeta--agotado");
  } else if (p.destacado) {
    etiqueta.textContent = "Favorito";
    etiqueta.hidden = false;
  }

  return nodo;
}

function textoEstado(total) {
  if (total === 0) return "No se encontraron productos con los filtros actuales.";

  const partes = [`Mostrando ${total} ${total === 1 ? "producto" : "productos"}`];
  if (categoriaActiva !== TODAS) partes.push(`en «${categoriaActiva}»`);
  if (busqueda.trim() !== "") partes.push(`que coinciden con «${busqueda.trim()}»`);
  if (ocultarAgotados) partes.push("(solo disponibles)");
  return `${partes.join(" ")}.`;
}

function renderizarCatalogo(lista) {
  // Si el resultado es idéntico (mismos productos, mismo orden) no se toca el DOM
  const firma = lista.map((p) => p.id).join(",");
  if (firma !== firmaGrilla) {
    firmaGrilla = firma;
    if (lista.length === 0) {
      grilla.replaceChildren();
    } else {
      const fragmento = document.createDocumentFragment();
      lista.forEach((p) => fragmento.append(crearTarjeta(p)));
      grilla.replaceChildren(fragmento);
    }
  }
  estado.textContent = textoEstado(lista.length);
}

// Tarjetas "fantasma" mientras fetch resuelve
function mostrarFantasmas(cantidad = CANTIDAD_FANTASMAS) {
  firmaGrilla = null; // la grilla ya no contiene tarjetas reales
  const fragmento = document.createDocumentFragment();
  for (let i = 0; i < cantidad; i++) {
    const li = document.createElement("li");
    li.className = "tarjeta tarjeta--fantasma";
    li.setAttribute("aria-hidden", "true");
    li.innerHTML = `
      <div class="fantasma__foto"></div>
      <div class="tarjeta__cuerpo">
        <div class="fantasma__linea fantasma__linea--corta"></div>
        <div class="fantasma__linea fantasma__linea--titulo"></div>
        <div class="fantasma__linea"></div>
        <div class="fantasma__linea fantasma__linea--media"></div>
      </div>`;
    fragmento.append(li);
  }
  grilla.replaceChildren(fragmento);
}

// =============================================================
// 7. Modal de detalle (<dialog>)
// =============================================================
function abrirModal(tarjeta) {
  const p = productosPorId.get(Number(tarjeta.dataset.id));
  if (!p || typeof modal.showModal !== "function") return;

  tarjetaOrigen = tarjeta;

  configurarImagen(modalImg, p, SIZES_MODAL);
  modalCategoria.textContent = p.categoria;
  modalTitulo.textContent = p.nombre;
  modalDescripcion.textContent = p.descripcion;
  modalPrecio.textContent = soles.format(p.precio);
  modalStock.textContent =
    p.stock === 0 ? "Agotado" : `${p.stock} ${p.stock === 1 ? "unidad disponible" : "unidades disponibles"}`;
  modalStock.classList.toggle("modal__stock--agotado", p.stock === 0);
  modalPorciones.textContent = p.porciones > 1 ? `${p.porciones} porciones` : "1 unidad";

  modal.showModal();
}

// "close" se dispara con Escape, con los botones y con clic en el fondo
modal.addEventListener("close", () => {
  if (tarjetaOrigen?.isConnected) tarjetaOrigen.focus();
  tarjetaOrigen = null;
});

modalCerrar.addEventListener("click", () => modal.close());
modalCerrarPie.addEventListener("click", () => modal.close());

// Clic en el fondo oscuro (el propio <dialog>, fuera del contenido)
modal.addEventListener("click", (evento) => {
  if (evento.target === modal) modal.close();
});

// =============================================================
// 8. Hash de la URL: catalogo.html#Tortas
// =============================================================
function leerCategoriaDeHash() {
  const crudo = location.hash.slice(1);
  if (!crudo) return null;

  let texto;
  try {
    texto = decodeURIComponent(crudo);
  } catch {
    console.warn(`El hash «${crudo}» no es válido; se muestra «${TODAS}».`);
    return null;
  }

  const buscada = normalizar(texto);
  const encontrada = categorias.find((cat) => normalizar(cat) === buscada);

  // #catalogo y #contacto son anclas de la página, no categorías: no se avisa
  if (!encontrada && !document.getElementById(texto)) {
    console.warn(`La categoría «${texto}» no existe en el catálogo; se muestra «${TODAS}».`);
  }
  return encontrada ?? null;
}

// Si el usuario edita el hash a mano en la barra de direcciones
window.addEventListener("hashchange", () => {
  if (productos.length === 0) return;

  const hashVacio = location.hash.slice(1) === "";
  const desdeHash = hashVacio ? TODAS : leerCategoriaDeHash();

  if (desdeHash && desdeHash !== categoriaActiva) {
    categoriaActiva = desdeHash;
    actualizarVista();
  }
});

// =============================================================
// 9. Eventos (delegación)
// =============================================================
// Filtros de categoría
contFiltros.addEventListener("click", (evento) => {
  const boton = evento.target.closest(".filtro");
  if (!boton || boton.dataset.categoria === categoriaActiva) return;

  categoriaActiva = boton.dataset.categoria;
  actualizarVista(); // también actualiza la URL
});

// Controles: "input" para el buscador, "change" para select y casilla
contControles.addEventListener("input", (evento) => {
  if (evento.target !== campoBuscador) return;
  busqueda = campoBuscador.value;
  actualizarBotonLimpiar(); // reacciona al instante, sin esperar el debounce

  // Pequeña espera para no renderizar (ni anunciar) en cada tecla
  clearTimeout(temporizadorBusqueda);
  temporizadorBusqueda = setTimeout(actualizarVista, 200);
});

contControles.addEventListener("change", (evento) => {
  if (evento.target === campoOrden) {
    orden = campoOrden.value;
  } else if (evento.target === casillaAgotados) {
    ocultarAgotados = casillaAgotados.checked;
  } else {
    return;
  }
  clearTimeout(temporizadorBusqueda);
  actualizarVista();
});

// Tarjetas: un solo listener en #grilla
grilla.addEventListener("click", (evento) => {
  const tarjeta = evento.target.closest(".tarjeta[data-id]");
  if (!tarjeta || !grilla.contains(tarjeta)) return;

  // «Comparar» NO abre el detalle
  if (evento.target.closest(".tarjeta__comparar")) {
    alternarComparacion(Number(tarjeta.dataset.id));
    return;
  }
  abrirModal(tarjeta);
});

grilla.addEventListener("keydown", (evento) => {
  if (evento.key !== "Enter" && evento.key !== " ") return;
  const tarjeta = evento.target.closest(".tarjeta[data-id]");
  if (!tarjeta || evento.target !== tarjeta) return;
  evento.preventDefault(); // evita el scroll con la barra espaciadora
  abrirModal(tarjeta);
});

// Botón «Limpiar filtros»
btnLimpiar.addEventListener("click", limpiarFiltros);

// Botón «Reintentar»
btnReintentar.addEventListener("click", () => {
  iniciar();
  estado.focus(); // el botón se oculta: se devuelve el foco al mensaje de estado
});

// =============================================================
// 9b. Reto 2: modo «Comparar» (máx. 3), barra flotante y <dialog>
// =============================================================
const textoStock = (p) =>
  p.stock === 0
    ? "Agotado"
    : `${p.stock} ${p.stock === 1 ? "unidad disponible" : "unidades disponibles"}`;

const textoPorciones = (p) => (p.porciones > 1 ? `${p.porciones} porciones` : "1 unidad");

// Mensaje para lectores de pantalla (#estado es aria-live="polite").
// Se vacía primero para que se vuelva a anunciar aunque el texto se repita.
function anunciar(mensaje) {
  estado.classList.remove("estado--error");
  estado.textContent = "";
  setTimeout(() => {
    estado.textContent = mensaje;
  }, 30);
}

const productosSeleccionados = () =>
  seleccion.map((id) => productosPorId.get(id)).filter(Boolean);

// Solo toca los botones «Comparar» ya pintados: NO re-renderiza la grilla
function actualizarBotonesComparar() {
  grilla.querySelectorAll(".tarjeta[data-id]").forEach((tarjeta) => {
    const marcado = seleccion.includes(Number(tarjeta.dataset.id));
    tarjeta.querySelector(".tarjeta__comparar")?.setAttribute("aria-pressed", String(marcado));
  });
}

function alternarComparacion(id) {
  const p = productosPorId.get(id);
  if (!p) return;

  const posicion = seleccion.indexOf(id);
  if (posicion >= 0) {
    seleccion.splice(posicion, 1);
    anunciar(`«${p.nombre}» se quitó de la comparación. Quedan ${seleccion.length} de ${MAX_COMPARAR}.`);
  } else if (seleccion.length >= MAX_COMPARAR) {
    // 4.º producto: se impide y se avisa (voz + mensaje visible en la barra)
    anunciar(
      `Solo puede comparar hasta ${MAX_COMPARAR} productos. Quite uno para añadir «${p.nombre}».`,
    );
    avisarLimiteEnBarra();
    return;
  } else {
    seleccion.push(id);
    anunciar(`«${p.nombre}» se añadió a la comparación. Lleva ${seleccion.length} de ${MAX_COMPARAR}.`);
  }

  actualizarBotonesComparar();
  renderizarBarra();
}

function textoContador(cantidad) {
  const base = `Comparar: ${cantidad} de ${MAX_COMPARAR}`;
  const faltan = MIN_COMPARAR - cantidad;
  return faltan > 0 ? `${base} · elija ${faltan} más para comparar` : base;
}

// Mensaje visible (la voz ya se anunció en #estado)
function avisarLimiteEnBarra() {
  barraContador.textContent = `Máximo ${MAX_COMPARAR} productos: quite uno para añadir otro.`;
  barra.classList.add("barra-comparar--limite");
  clearTimeout(temporizadorLimite);
  temporizadorLimite = setTimeout(() => {
    barra.classList.remove("barra-comparar--limite");
    barraContador.textContent = textoContador(seleccion.length);
  }, 2800);
}

// La barra tiene como máximo 3 chips: se rehace completa sin problema
function renderizarBarra() {
  const items = productosSeleccionados();
  barra.hidden = items.length === 0;
  document.body.classList.toggle("con-barra", items.length > 0);

  if (items.length === 0) {
    barraLista.replaceChildren();
    return;
  }

  const fragmento = document.createDocumentFragment();
  items.forEach((p) => {
    const li = document.createElement("li");
    li.className = "chip";

    const img = document.createElement("img");
    img.width = 40;
    img.height = 40;
    configurarImagen(img, p, "40px");
    img.alt = ""; // el nombre ya está escrito al lado

    const nombre = document.createElement("span");
    nombre.className = "chip__nombre";
    nombre.textContent = p.nombre;

    const quitar = document.createElement("button");
    quitar.type = "button";
    quitar.className = "chip__quitar";
    quitar.dataset.id = p.id;
    quitar.setAttribute("aria-label", `Quitar ${p.nombre} de la comparación`);
    quitar.textContent = "✕";

    li.append(img, nombre, quitar);
    fragmento.append(li);
  });
  barraLista.replaceChildren(fragmento);

  barra.classList.remove("barra-comparar--limite");
  barraContador.textContent = textoContador(items.length);
  btnVer.disabled = items.length < MIN_COMPARAR;
}

// El alto de la barra se publica como variable CSS: el pie de página y el botón
// «Volver arriba» se apartan para no quedar tapados.
if ("ResizeObserver" in window) {
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--alto-barra", `${barra.hidden ? 0 : barra.offsetHeight}px`);
  }).observe(barra);
}

// Quitar un chip o vaciar: el foco no debe perderse
function enfocarTrasQuitar(indice) {
  const botones = barraLista.querySelectorAll(".chip__quitar");
  const destino =
    botones[Math.min(indice, botones.length - 1)] ??
    grilla.querySelector(".tarjeta__comparar") ??
    campoBuscador;
  if (!destino.disabled) destino.focus();
}

barraLista.addEventListener("click", (evento) => {
  const quitar = evento.target.closest(".chip__quitar");
  if (!quitar) return;

  const id = Number(quitar.dataset.id);
  const indice = seleccion.indexOf(id);
  const p = productosPorId.get(id);
  if (indice < 0) return;

  seleccion.splice(indice, 1);
  anunciar(`«${p?.nombre ?? "Producto"}» se quitó de la comparación. Quedan ${seleccion.length} de ${MAX_COMPARAR}.`);
  actualizarBotonesComparar();
  renderizarBarra();
  enfocarTrasQuitar(indice);
});

btnVaciar.addEventListener("click", () => {
  if (seleccion.length === 0) return;
  seleccion = [];
  anunciar("Se vació la comparación.");
  actualizarBotonesComparar();
  renderizarBarra();
  enfocarTrasQuitar(0);
});

// --- Tabla comparativa dentro del <dialog> ----------------------
function celda(etiqueta, texto, clase) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  el.textContent = texto;
  return el;
}

const FILAS_COMPARATIVA = [
  { titulo: "Categoría", valor: (p) => p.categoria },
  { titulo: "Precio", valor: (p) => soles.format(p.precio), clave: "precio" },
  { titulo: "Stock", valor: textoStock, clave: "stock" },
  { titulo: "Porciones", valor: textoPorciones },
  { titulo: "Descripción", valor: (p) => p.descripcion || "—" },
];

function construirTabla(items) {
  const tabla = document.createElement("table");
  tabla.className = "tabla-comparar";
  tabla.style.setProperty("--columnas", items.length);

  tabla.append(celda("caption", `Comparativa de ${items.length} productos`, "visualmente-oculto"));

  // Cabecera: una columna por producto
  const cabecera = tabla.createTHead().insertRow();
  const esquina = celda("th", "Característica", "visualmente-oculto");
  esquina.scope = "col";
  cabecera.append(esquina);

  items.forEach((p) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.className = "tabla-comparar__producto";

    const img = document.createElement("img");
    img.width = 96;
    img.height = 96;
    configurarImagen(img, p, "96px");
    img.alt = "";

    th.append(img, celda("span", p.nombre));
    cabecera.append(th);
  });

  // Cuerpo: una fila por característica
  const cuerpo = tabla.createTBody();
  const precios = items.map((p) => p.precio);
  const minimo = Math.min(...precios);
  const hayDiferencia = minimo !== Math.max(...precios);

  FILAS_COMPARATIVA.forEach((fila) => {
    const tr = cuerpo.insertRow();
    const titulo = celda("th", fila.titulo);
    titulo.scope = "row";
    tr.append(titulo);

    items.forEach((p) => {
      const td = celda("td", fila.valor(p));
      if (fila.clave === "stock" && p.stock === 0) td.classList.add("tabla-comparar__agotado");
      if (fila.clave === "precio" && hayDiferencia && p.precio === minimo) {
        td.classList.add("tabla-comparar__mejor");
        td.append(celda("span", "Más económico", "insignia"));
      }
      tr.append(td);
    });
  });

  return tabla;
}

function abrirComparativa() {
  const items = productosSeleccionados();
  if (items.length < MIN_COMPARAR || typeof dlgComparar.showModal !== "function") return;

  contTabla.replaceChildren(construirTabla(items));
  contTabla.scrollLeft = 0;
  dlgComparar.showModal(); // Escape lo cierra de forma nativa
}

btnVer.addEventListener("click", abrirComparativa);
btnCompararCerrar.addEventListener("click", () => dlgComparar.close());
btnCompararCerrarPie.addEventListener("click", () => dlgComparar.close());

// Clic en el fondo oscuro
dlgComparar.addEventListener("click", (evento) => {
  if (evento.target === dlgComparar) dlgComparar.close();
});

// Se dispara con Escape, botones y fondo: el foco vuelve al disparador
dlgComparar.addEventListener("close", () => {
  const destino = !barra.hidden && !btnVer.disabled ? btnVer : campoBuscador;
  if (destino.isConnected && !destino.disabled) destino.focus();
});

// =============================================================
// 9c. Reto 2: botón «Volver arriba y buscar» (IntersectionObserver)
// =============================================================
function volverArribaYBuscar() {
  const reducir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Sube al inicio del catálogo (el buscador queda a la vista).
  // Para subir al inicio absoluto de la página use window.scrollTo({ top: 0, ... }).
  seccionCatalogo.scrollIntoView({ behavior: reducir ? "auto" : "smooth", block: "start" });

  // preventScroll: el foco no interrumpe el desplazamiento suave
  if (!campoBuscador.disabled) campoBuscador.focus({ preventScroll: true });
}

function configurarVolverArriba() {
  btnArriba.addEventListener("click", volverArribaYBuscar);

  if (!("IntersectionObserver" in window)) {
    btnArriba.classList.add("volver-arriba--visible"); // navegadores muy antiguos
    return;
  }

  // Referencia: el bloque de controles (parte superior del catálogo).
  // Se observa él y no la primera tarjeta porque la grilla se vuelve a pintar.
  const observador = new IntersectionObserver(
    ([entrada]) => {
      // "Salió por arriba" = el usuario ya pasó de largo hacia abajo.
      // Si está por debajo del viewport (página recién abierta) no se muestra.
      const limiteSuperior = entrada.rootBounds ? entrada.rootBounds.top : 0;
      const pasoPorArriba = !entrada.isIntersecting && entrada.boundingClientRect.top < limiteSuperior;
      btnArriba.classList.toggle("volver-arriba--visible", pasoPorArriba);
    },
    { rootMargin: `-${MARGEN_CABECERA}px 0px 0px 0px` }, // descuenta la cabecera fija
  );
  observador.observe(contControles);
}

// =============================================================
// 10. Inicio
// =============================================================
function activarControles(activo) {
  contControles.querySelectorAll("input, select").forEach((el) => {
    el.disabled = !activo;
  });
  if (!activo) btnLimpiar.disabled = true; // al activar lo decide actualizarBotonLimpiar()
}

// La URL manda: se restaura el estado desde ella y se vuelca en los controles
// (así se ignoran también los valores que el navegador restaure al recargar).
function restaurarFiltrosDesdeURL() {
  const filtros = leerFiltrosDeURL();
  busqueda = filtros.q;
  orden = filtros.orden;
  ocultarAgotados = filtros.agotados;
  volcarEstadoEnControles();
}

function mostrarError(error) {
  console.error(error, error?.causa ?? "");

  productos = [];
  productosPorId = new Map();
  firmaGrilla = null;
  seleccion = [];
  renderizarBarra();
  grilla.replaceChildren();
  contFiltros.replaceChildren();

  estado.textContent =
    error instanceof ErrorCatalogo
      ? error.mensajeUsuario
      : "Ocurrió un error inesperado al mostrar el catálogo. Pulse «Reintentar».";
  estado.classList.add("estado--error");
  btnReintentar.hidden = false;
}

async function iniciar() {
  if (cargando) return;
  cargando = true;

  grilla.setAttribute("aria-busy", "true");
  btnReintentar.hidden = true;
  aviso.hidden = true;
  estado.classList.remove("estado--error");
  estado.textContent = "Cargando productos…";
  activarControles(false);
  mostrarFantasmas();

  try {
    const datos = await cargarProductos();
    const { validos, descartados } = validarProductos(datos);
    reportarDescartados(descartados);

    if (validos.length === 0) {
      throw new ErrorCatalogo(
        "vacio",
        "El catálogo no tiene productos válidos para mostrar. Revise la consola para ver los detalles.",
        "Todos los productos fueron descartados",
      );
    }

    productos = validos;
    productosPorId = new Map(validos.map((p) => [p.id, p]));
    categorias = obtenerCategorias(productos);
    categoriaActiva = leerCategoriaDeHash() ?? TODAS;

    restaurarFiltrosDesdeURL();
    seleccion = seleccion.filter((id) => productosPorId.has(id)); // por si se recargó el JSON
    renderizarFiltros();
    activarControles(true);
    actualizarVista({ sincronizarURL: false });
    renderizarBarra();
  } catch (error) {
    mostrarError(error);
  } finally {
    grilla.setAttribute("aria-busy", "false");
    cargando = false;
  }
}

configurarVolverArriba();
iniciar();
