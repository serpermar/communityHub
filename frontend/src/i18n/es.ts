// ---------------------------------------------------------------------------
// Catalogo de textos en castellano.
//
// Capa ligera de traduccion (sin dependencias): los textos del *shell* (layout,
// navegacion, estados comunes, errores de red) viven aqui y se leen con `t`.
// Las paginas de cada modulo siguen con sus literales en castellano; moverlas
// aqui es un trabajo incremental que esta infraestructura deja preparado.
// ---------------------------------------------------------------------------

export const es = {
  app: {
    name: 'CommunityHub',
    noCommunityTitle: 'Aún no tienes ninguna comunidad',
    noCommunityBody:
      'Entra con una invitación o crea una comunidad si eres administrador de plataforma.',
    redeemInvitation: 'Canjear invitación',
    createCommunity: 'Crear comunidad',
    newCommunity: 'Nueva comunidad',
    logout: 'Salir',
    account: 'Mi cuenta',
    switchCommunity: 'Comunidad',
    noCommunityOption: 'Sin comunidad',
    openMenu: 'Abrir menú',
    closeMenu: 'Cerrar menú',
    navigation: 'Navegación',
    toggleTheme: 'Cambiar tema',
    themeLight: 'Tema claro',
    themeDark: 'Tema oscuro',
  },
  nav: {
    dashboard: 'Panel',
    incidents: 'Incidencias',
    commonAreas: 'Zonas comunes',
    reservations: 'Reservas',
    announcements: 'Avisos',
    documents: 'Documentos',
    finance: 'Finanzas',
    votes: 'Votaciones',
    assistant: 'Asistente IA',
    members: 'Miembros',
    settings: 'Ajustes',
  },
  common: {
    loading: 'Cargando…',
    checkingSession: 'Comprobando sesión…',
    retry: 'Reintentar',
    cancel: 'Cancelar',
    save: 'Guardar',
    close: 'Cerrar',
    back: 'Volver',
    delete: 'Eliminar',
    edit: 'Editar',
    search: 'Buscar',
    page: 'Página',
    of: 'de',
    total: 'en total',
    previous: 'Anterior',
    next: 'Siguiente',
    notFoundTitle: 'Página no encontrada',
    notFoundBody: 'La página que buscas no existe o se ha movido.',
    backHome: 'Volver al inicio',
    forbidden: 'No tienes permiso para ver esta sección.',
    emptyValue: '—',
  },
  notifications: {
    title: 'Notificaciones',
    markAll: 'Marcar todas',
    empty: 'No tienes notificaciones.',
    unread: 'No leída',
    viewAll: 'Ver todas',
    pageTitle: 'Notificaciones',
    all: 'Todas',
    onlyUnread: 'Sin leer',
  },
  toast: {
    saved: 'Cambios guardados.',
    created: 'Creado correctamente.',
    deleted: 'Eliminado.',
    updated: 'Actualizado.',
  },
  dashboard: {
    expenseTrend: 'Tendencia de gastos por mes',
  },
  errors: {
    network: 'No se pudo conectar con el servidor.',
    unknown: 'Ha ocurrido un error inesperado.',
  },
} as const

export type Dictionary = typeof es
