// Almacén de registros con la misma capa que usa Operación: un archivo JSON en data/.
//
// Interfaz (la que usa el servidor; para pasar a una base de datos basta con escribir
// otro objeto con estos mismos cuatro métodos y cambiar una línea en server.js):
//   guardar(registro) -> registro         crea o reemplaza por `id`
//   listar()          -> registro[]       todos, en el orden en que se guardaron
//   obtener(id)       -> registro | null
//   borrar(id)        -> boolean          true si existía
//
// Ojo: en el plan gratuito de Render el disco se borra al reiniciar el servicio;
// con este almacén los registros se pierden en cada reinicio.
import fs from 'node:fs';
import path from 'node:path';

export function crearAlmacenJSON(ruta) {
  const leer = () => {
    try {
      const datos = JSON.parse(fs.readFileSync(ruta, 'utf8'));
      return Array.isArray(datos) ? datos : [];
    } catch { return []; } // archivo inexistente o dañado: se empieza vacío
  };
  // Escribe en un temporal y lo renombra, para no dejar el archivo a medias si algo falla.
  const escribir = (lista) => {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    const tmp = `${ruta}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(lista, null, 1));
    fs.renameSync(tmp, ruta);
  };
  return {
    tipo: 'archivo JSON',
    guardar(registro) {
      if (!registro?.id) throw new Error('El registro necesita un id');
      const lista = leer();
      const i = lista.findIndex((x) => x.id === registro.id);
      if (i >= 0) lista[i] = registro; else lista.push(registro);
      escribir(lista);
      return registro;
    },
    listar: () => leer(),
    obtener: (id) => leer().find((x) => x.id === id) || null,
    borrar(id) {
      const lista = leer();
      const nueva = lista.filter((x) => x.id !== id);
      if (nueva.length === lista.length) return false;
      escribir(nueva);
      return true;
    },
  };
}
