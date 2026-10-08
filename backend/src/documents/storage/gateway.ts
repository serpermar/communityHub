// ---------------------------------------------------------------------------
// Puerta de entrada al Storage de documentos (spec 08 §9).
//
// El backend nunca toca el bucket directamente; habla con un driver que
// implementa esta interfaz. Hay dos implementaciones:
//
//   - `local`: vuelca los archivos a una carpeta temporal del sistema.
//     Sin claves de Supabase, es como desarrollo y como tests corren.
//   - `supabase`: firma contra el bucket `community-documents`.
//
// Los tres metodos son todo lo que el modulo necesita: subir, borrar y dar
// una URL con caducidad. No hay lectura de archivos porque nadie lee el
// binario por el backend: el que descarga usa la signed URL directamente
// (un fichero de 10 MB ni siquiera pasaria desapercibido por aqui).
// ---------------------------------------------------------------------------

/** Un driver de Storage. Las rutas son `<community_id>/<uuid>`. */
export interface StorageGateway {
  /**
   * Sube un objeto. En Supabase el `contentType` viaja para que la cabecera
   * del fichero al descargarlo sea la que el ADMIN declaro, no el "guess" del
   * provedor a partir de la extension.
   */
  upload(path: string, data: Buffer, mime: string): Promise<void>
  /** Borra el objeto. Borrar algo que no existe no es un error. */
  remove(path: string): Promise<void>
  /** URL firmada con caducidad, para la descarga (spec §7.3 GET download). */
  signedUrl(path: string, expiresIn: number): Promise<string>
}