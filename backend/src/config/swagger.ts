// ---------------------------------------------------------------------------
// Especificación OpenAPI 3.0 de la API.
// ---------------------------------------------------------------------------

import swaggerJsdoc from 'swagger-jsdoc'

const cwd = process.cwd()

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'CommunityHub API',
      version: '1.0.0',
      description: [
        'API de gestión de comunidades de vecinos: miembros, invitaciones,',
        'incidencias, zonas comunes, reservas, avisos, documentos, finanzas,',
        'votaciones, IA y notificaciones.',
        '',
        'Todas las rutas salvo `POST /api/v1/auth/login`, `POST /api/v1/auth/register`',
        'y `GET /health` exigen un access token JWT en `Authorization: Bearer <token>`.',
        '',
        '**Envelope**: todas las respuestas de éxito van envueltas en `{ data: ... }`',
        'y las de error en `{ error: { code, message } }`.',
        '',
        '**Roles**: cada usuario tiene un `globalRole` (plataforma) y, por cada',
        'comunidad, un `role` distinto en la tabla `members`.',
      ].join('\n'),
    },
    servers: [{ url: 'http://localhost:3000', description: 'Desarrollo' }],
    tags: [
      { name: 'Health', description: 'Estado del servicio y de la base de datos' },
      { name: 'Auth', description: 'Registro, login, refresh, logout y export' },
      { name: 'Communities', description: 'CRUD de comunidades' },
      { name: 'Members', description: 'Gestión de miembros y roles' },
      { name: 'Invitations', description: 'Invitaciones y canje' },
      { name: 'Incidents', description: 'Incidencias vecinales' },
      { name: 'CommonAreas', description: 'Zonas comunes' },
      { name: 'Reservations', description: 'Reservas de zonas comunes' },
      { name: 'Announcements', description: 'Avisos de la comunidad' },
      { name: 'Documents', description: 'Biblioteca de documentos' },
      { name: 'Finance', description: 'Gastos, facturas y resumen financiero' },
      { name: 'Votes', description: 'Votaciones' },
      { name: 'AI', description: 'Asistente IA y agentes' },
      { name: 'External', description: 'Meteorología y mapa' },
      { name: 'Dashboard', description: 'Resumen de la home' },
      { name: 'Notifications', description: 'Campana del usuario' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Access token emitido por `POST /api/v1/auth/login`.',
        },
      },
      schemas: {
        // --- Comunes ---------------------------------------------
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: { code: { type: 'string' }, message: { type: 'string' } },
            },
          },
        },
        PaginationMeta: {
          type: 'object',
          required: ['page', 'limit', 'total'],
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 4 },
            totalPages: { type: 'integer', nullable: true, example: 1 },
          },
        },

        // --- Auth (verificado) -----------------------------------
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            fullName: { type: 'string' },
            phone: { type: 'string', nullable: true },
            avatarUrl: { type: 'string', format: 'uri', nullable: true },
            globalRole: { type: 'string', enum: ['NEIGHBOR', 'ADMIN'] },
            emailVerifiedAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        AuthLoginResponse: {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: {
                accessToken: { type: 'string' },
                expiresIn: { type: 'integer', example: 900 },
                user: { $ref: '#/components/schemas/User' },
              },
            },
          },
        },
        AuthSession: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userAgent: { type: 'string' },
            ip: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            lastUsedAt: { type: 'string', format: 'date-time' },
            current: { type: 'boolean' },
          },
        },
        AvatarResponse: {
          type: 'object',
          properties: {
            data: { type: 'object', properties: { avatarUrl: { type: 'string', nullable: true } } },
          },
        },
        UserExport: {
          type: 'object',
          properties: { data: { type: 'object', additionalProperties: true } },
        },

        // --- Communities / Members / Invitations (verificado) ----
        Community: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            slug: { type: 'string' },
            description: { type: 'string', nullable: true },
            addressLine1: { type: 'string' },
            city: { type: 'string' },
            province: { type: 'string' },
            postalCode: { type: 'string' },
            country: { type: 'string' },
            latitude: { type: 'number', nullable: true },
            longitude: { type: 'number', nullable: true },
            timezone: { type: 'string' },
            registrationNumber: { type: 'string', nullable: true },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            memberRole: { type: 'string', enum: ['NEIGHBOR', 'PRESIDENT', 'ADMIN'] },
          },
        },
        CommunityListResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/Community' } },
          },
        },
        Member: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            fullName: { type: 'string' },
            email: { type: 'string', format: 'email' },
            unitNumber: { type: 'string', nullable: true },
            role: { type: 'string', enum: ['NEIGHBOR', 'PRESIDENT', 'ADMIN'] },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'PENDING'] },
            joinedAt: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        MemberListResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/Member' } },
            meta: { $ref: '#/components/schemas/PaginationMeta' },
          },
        },
        Invitation: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email', nullable: true },
            expiresAt: { type: 'string', format: 'date-time' },
            acceptedAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        InvitationCreatedResponse: {
          type: 'object',
          properties: {
            data: {
              allOf: [
                { $ref: '#/components/schemas/Invitation' },
                {
                  type: 'object',
                  properties: {
                    code: { type: 'string' },
                    role: { type: 'string', enum: ['NEIGHBOR', 'PRESIDENT', 'ADMIN'] },
                  },
                },
              ],
            },
          },
        },
        InvitationListResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/Invitation' } },
          },
        },

        // --- Documents (verificado) ------------------------------
        DocumentCategory: { type: 'string', enum: ['ACTA', 'NORMA', 'PRESUPUESTO', 'OTHER'] },
        Document: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            communityId: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
            category: { $ref: '#/components/schemas/DocumentCategory' },
            mimeType: { type: 'string' },
            sizeBytes: { type: 'integer' },
            checksum: { type: 'string' },
            minRole: { type: 'string', enum: ['NEIGHBOR', 'PRESIDENT', 'ADMIN'] },
            isPublic: { type: 'boolean' },
            uploadedBy: { type: 'string', format: 'uuid' },
            uploadedByName: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        DocumentListResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/Document' } },
            meta: { $ref: '#/components/schemas/PaginationMeta' },
          },
        },
        DocumentDownloadResponse: {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: {
                url: { type: 'string', format: 'uri' },
                expiresAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },

        // --- Incidents (verificado) ------------------------------
        IncidentCategory: {
          type: 'string',
          enum: ['PLUMBING', 'ELECTRICITY', 'HEATING', 'ELEVATOR', 'CLEANING', 'SECURITY', 'OTHER'],
        },
        IncidentPriority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        IncidentStatus: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED'] },
        IncidentCreatedVia: { type: 'string', enum: ['MANUAL', 'AI_SUGGESTION'] },
        Incident: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            communityId: { type: 'string', format: 'uuid' },
            referenceCode: { type: 'string', example: 'INC-2026-0001' },
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
            category: { $ref: '#/components/schemas/IncidentCategory' },
            priority: { $ref: '#/components/schemas/IncidentPriority' },
            status: { $ref: '#/components/schemas/IncidentStatus' },
            location: { type: 'string', nullable: true },
            reporterId: { type: 'string', format: 'uuid' },
            reporterName: { type: 'string' },
            assignedToId: { type: 'string', format: 'uuid', nullable: true },
            assignedToName: { type: 'string', nullable: true },
            needsReview: { type: 'boolean' },
            createdVia: { $ref: '#/components/schemas/IncidentCreatedVia' },
            resolvedAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        IncidentListResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/Incident' } },
            meta: { $ref: '#/components/schemas/PaginationMeta' },
          },
        },
        IncidentComment: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            incidentId: { type: 'string', format: 'uuid' },
            authorId: { type: 'string', format: 'uuid' },
            authorName: { type: 'string' },
            body: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        IncidentCommentListResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/IncidentComment' } },
          },
        },

        // --- CommonAreas (verificado) ----------------------------
        CommonAreaType: {
          type: 'string',
          enum: [
            'SWIMMING_POOL',
            'PADEL_COURT',
            'TENNIS_COURT',
            'GYM',
            'MEETING_ROOM',
            'GARDEN',
            'OTHER',
          ],
        },
        CommonArea: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            communityId: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            type: { $ref: '#/components/schemas/CommonAreaType' },
            description: { type: 'string', nullable: true },
            capacity: { type: 'integer', nullable: true },
            slotMinutes: { type: 'integer', example: 60 },
            openTime: { type: 'string', example: '08:00' },
            closeTime: { type: 'string', example: '22:00' },
            maxDailyReservations: { type: 'integer', nullable: true },
            requiresApproval: { type: 'boolean' },
            isActive: { type: 'boolean' },
            createdBy: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CommonAreaListResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/CommonArea' } },
          },
        },
        CommonAreaSlotStatus: {
          type: 'string',
          enum: ['FREE', 'RESERVED', 'BLOCKED'],
        },
        CommonAreaAvailabilitySlot: {
          type: 'object',
          properties: {
            startsAt: { type: 'string', format: 'date-time' },
            endsAt: { type: 'string', format: 'date-time' },
            status: { $ref: '#/components/schemas/CommonAreaSlotStatus' },
          },
        },
        CommonAreaAvailability: {
          type: 'object',
          properties: {
            date: { type: 'string', format: 'date', example: '2026-11-10' },
            slotMinutes: { type: 'integer', example: 60 },
            openTime: { type: 'string', example: '08:00' },
            closeTime: { type: 'string', example: '22:00' },
            slots: {
              type: 'array',
              items: { $ref: '#/components/schemas/CommonAreaAvailabilitySlot' },
            },
          },
        },

        // --- Announcements (a verificar contra la API) -----------
        AnnouncementType: {
          type: 'string',
          enum: ['MEETING', 'NOTICE', 'MAINTENANCE', 'EMERGENCY', 'OTHER'],
        },
        AnnouncementPriority: {
          type: 'string',
          enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
        },
        Announcement: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            communityId: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            body: { type: 'string' },
            type: { $ref: '#/components/schemas/AnnouncementType' },
            priority: { $ref: '#/components/schemas/AnnouncementPriority' },
            isPinned: { type: 'boolean' },
            minRole: { type: 'string', enum: ['NEIGHBOR', 'PRESIDENT', 'ADMIN'] },
            publishAt: { type: 'string', format: 'date-time' },
            expiresAt: { type: 'string', format: 'date-time', nullable: true },
            publishedBy: { type: 'string', format: 'uuid' },
            publishedByName: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        AnnouncementListResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/Announcement' } },
            meta: { $ref: '#/components/schemas/PaginationMeta' },
          },
        },

        // --- Reservations (verificado) ---------------------------
        ReservationStatus: {
          type: 'string',
          enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'],
        },
        Reservation: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            communityId: { type: 'string', format: 'uuid' },
            communityName: { type: 'string' },
            commonAreaId: { type: 'string', format: 'uuid' },
            commonAreaName: { type: 'string' },
            userId: { type: 'string', format: 'uuid' },
            userName: { type: 'string' },
            startsAt: { type: 'string', format: 'date-time' },
            endsAt: { type: 'string', format: 'date-time' },
            status: { $ref: '#/components/schemas/ReservationStatus' },
            attendees: { type: 'integer', nullable: true },
            notes: { type: 'string', nullable: true },
            cancelledAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        ReservationListResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/Reservation' } },
            meta: { $ref: '#/components/schemas/PaginationMeta' },
          },
        },

        // --- Finance (verificado) --------------------------------
        ExpenseCategory: {
          type: 'string',
          enum: ['MAINTENANCE', 'UTILITIES', 'CLEANING', 'SECURITY', 'INSURANCE', 'OTHER'],
        },
        Expense: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            communityId: { type: 'string', format: 'uuid' },
            concept: { type: 'string' },
            category: { $ref: '#/components/schemas/ExpenseCategory' },
            amount: { type: 'number', format: 'float', description: 'Importe en euros.' },
            expenseDate: { type: 'string', format: 'date' },
            supplier: { type: 'string', nullable: true },
            notes: { type: 'string', nullable: true },
            invoiceId: { type: 'string', format: 'uuid', nullable: true },
            invoiceNumber: { type: 'string', nullable: true },
            createdBy: { type: 'string', format: 'uuid' },
            createdByName: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        ExpenseListResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/Expense' } },
            meta: { $ref: '#/components/schemas/PaginationMeta' },
          },
        },
        InvoiceStatus: { type: 'string', enum: ['PENDING', 'PAID', 'OVERDUE', 'CANCELLED'] },
        Invoice: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            communityId: { type: 'string', format: 'uuid' },
            number: { type: 'string', example: 'INV-2026-001' },
            concept: { type: 'string' },
            amount: { type: 'number', format: 'float' },
            issueDate: { type: 'string', format: 'date' },
            dueDate: { type: 'string', format: 'date', nullable: true },
            paidAt: { type: 'string', format: 'date-time', nullable: true },
            status: { $ref: '#/components/schemas/InvoiceStatus' },
            effectiveStatus: { $ref: '#/components/schemas/InvoiceStatus' },
            supplier: { type: 'string', nullable: true },
            isGenerated: { type: 'boolean' },
            createdBy: { type: 'string', format: 'uuid' },
            createdByName: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        InvoiceListResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/Invoice' } },
            meta: { $ref: '#/components/schemas/PaginationMeta' },
          },
        },
        FinanceSummaryExpenseByCategory: {
          type: 'object',
          properties: {
            count: { type: 'integer' },
            total: { type: 'number', format: 'float' },
            category: { $ref: '#/components/schemas/ExpenseCategory' },
          },
        },
        FinanceSummaryExpenseRecent: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            amount: { type: 'number', format: 'float' },
            concept: { type: 'string' },
            category: { $ref: '#/components/schemas/ExpenseCategory' },
            supplier: { type: 'string', nullable: true },
            expenseDate: { type: 'string', format: 'date' },
          },
        },
        FinanceSummary: {
          type: 'object',
          properties: {
            expenseTotal: { type: 'number', format: 'float' },
            expenseCount: { type: 'integer' },
            expenseByCategory: {
              type: 'array',
              items: { $ref: '#/components/schemas/FinanceSummaryExpenseByCategory' },
            },
            expenseRecent: {
              type: 'array',
              items: { $ref: '#/components/schemas/FinanceSummaryExpenseRecent' },
            },
            invoiceTotal: { type: 'number', format: 'float' },
            invoiceCount: { type: 'integer' },
            invoiceOpenAmount: { type: 'number', format: 'float' },
            invoicePaidAmount: { type: 'number', format: 'float' },
            invoicePendingCount: { type: 'integer' },
            invoiceOverdueCount: { type: 'integer' },
          },
        },

        // --- Voting (verificado) ---------------------------------
        VoteType: { type: 'string', enum: ['SINGLE', 'QUORUM', 'MULTIPLE'] },
        VoteStatus: { type: 'string', enum: ['DRAFT', 'OPEN', 'CLOSED'] },
        VoteResultVisibility: { type: 'string', enum: ['LIVE', 'AFTER_CLOSE'] },
        VoteOption: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            label: { type: 'string' },
            position: { type: 'integer' },
            isAbstention: { type: 'boolean' },
          },
        },
        Vote: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            communityId: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            question: { type: 'string' },
            description: { type: 'string', nullable: true },
            type: { $ref: '#/components/schemas/VoteType' },
            status: { $ref: '#/components/schemas/VoteStatus' },
            effectiveStatus: { $ref: '#/components/schemas/VoteStatus' },
            startsAt: { type: 'string', format: 'date-time' },
            endsAt: { type: 'string', format: 'date-time' },
            allowAbstention: { type: 'boolean' },
            quorumPercent: { type: 'integer', nullable: true },
            resultVisibility: { $ref: '#/components/schemas/VoteResultVisibility' },
            options: { type: 'array', items: { $ref: '#/components/schemas/VoteOption' } },
            myOptionId: { type: 'string', format: 'uuid', nullable: true },
            createdBy: { type: 'string', format: 'uuid' },
            createdByName: { type: 'string' },
            closedAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        VoteListResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/Vote' } },
            meta: { $ref: '#/components/schemas/PaginationMeta' },
          },
        },
        VoteResultOption: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            label: { type: 'string' },
            votes: { type: 'integer' },
            percent: { type: 'number', format: 'float' },
            position: { type: 'integer' },
            isAbstention: { type: 'boolean' },
          },
        },
        VoteResult: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            status: { $ref: '#/components/schemas/VoteStatus' },
            effectiveStatus: { $ref: '#/components/schemas/VoteStatus' },
            endsAt: { type: 'string', format: 'date-time' },
            allowAbstention: { type: 'boolean' },
            eligibleCount: { type: 'integer' },
            turnout: { type: 'integer' },
            participationPercent: { type: 'number', format: 'float' },
            quorumRequired: { type: 'boolean' },
            quorumPercent: { type: 'integer', nullable: true },
            quorumMet: { type: 'boolean' },
            abstentionCount: { type: 'integer' },
            options: { type: 'array', items: { $ref: '#/components/schemas/VoteResultOption' } },
          },
        },
        VoteResultExport: {
          type: 'object',
          properties: { data: { type: 'object', additionalProperties: true } },
        },

        // --- Notifications (verificado) --------------------------
        NotificationType: {
          type: 'string',
          enum: [
            'MEMBER_JOINED',
            'VOTE_OPEN',
            'VOTE_CLOSED',
            'INCIDENT_CREATED',
            'INCIDENT_STATUS_CHANGED',
            'ANNOUNCEMENT',
            'RESERVATION',
            'FINANCE',
            'SYSTEM',
          ],
        },
        Notification: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            type: { $ref: '#/components/schemas/NotificationType' },
            title: { type: 'string' },
            body: { type: 'string', nullable: true },
            payload: { type: 'object', additionalProperties: true },
            communityId: { type: 'string', format: 'uuid', nullable: true },
            readAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        NotificationListResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/Notification' } },
            meta: { $ref: '#/components/schemas/PaginationMeta' },
          },
        },
        UnreadCountResponse: {
          type: 'object',
          properties: { data: { type: 'object', properties: { count: { type: 'integer' } } } },
        },

        // --- Dashboard (verificado) ------------------------------
        DashboardVotes: {
          type: 'object',
          properties: {
            open: { type: 'array', items: { type: 'object', additionalProperties: true } },
            openCount: { type: 'integer' },
          },
        },
        DashboardPeriod: {
          type: 'object',
          properties: {
            to: { type: 'string', format: 'date' },
            from: { type: 'string', format: 'date' },
          },
        },
        DashboardFinanceExpensesByMonth: {
          type: 'object',
          properties: { month: { type: 'string', example: '2026-01' }, total: { type: 'number' } },
        },
        DashboardFinance: {
          type: 'object',
          properties: {
            expenseCount: { type: 'integer' },
            expenseTotal: { type: 'number', format: 'float' },
            expensesByMonth: {
              type: 'array',
              items: { $ref: '#/components/schemas/DashboardFinanceExpensesByMonth' },
            },
            invoiceOpenAmount: { type: 'number', format: 'float' },
            invoiceOverdueCount: { type: 'integer' },
            invoicePendingCount: { type: 'integer' },
          },
        },
        DashboardCommunity: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            city: { type: 'string' },
            name: { type: 'string' },
            memberCount: { type: 'integer' },
            neighborCount: { type: 'integer' },
          },
        },
        DashboardIncidentsByStatus: {
          type: 'object',
          properties: {
            count: { type: 'integer' },
            status: { $ref: '#/components/schemas/IncidentStatus' },
          },
        },
        DashboardIncidentsByCategory: {
          type: 'object',
          properties: {
            count: { type: 'integer' },
            category: { $ref: '#/components/schemas/IncidentCategory' },
          },
        },
        DashboardIncidents: {
          type: 'object',
          properties: {
            open: { type: 'integer' },
            pending: { type: 'integer' },
            byStatus: {
              type: 'array',
              items: { $ref: '#/components/schemas/DashboardIncidentsByStatus' },
            },
            critical: { type: 'integer' },
            byCategory: {
              type: 'array',
              items: { $ref: '#/components/schemas/DashboardIncidentsByCategory' },
            },
            inProgress: { type: 'integer' },
          },
        },
        DashboardReservationsByMonth: {
          type: 'object',
          properties: { count: { type: 'integer' }, month: { type: 'string' } },
        },
        DashboardReservations: {
          type: 'object',
          properties: {
            byMonth: {
              type: 'array',
              items: { $ref: '#/components/schemas/DashboardReservationsByMonth' },
            },
            upcoming: { type: 'array', items: { type: 'object', additionalProperties: true } },
            upcomingCount: { type: 'integer' },
          },
        },
        DashboardAnnouncementLatest: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            type: { type: 'string', example: 'MEETING' },
            title: { type: 'string' },
            isPinned: { type: 'boolean' },
            priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
            publishAt: { type: 'string', format: 'date-time' },
          },
        },
        DashboardAnnouncements: {
          type: 'object',
          properties: {
            latest: {
              type: 'array',
              items: { $ref: '#/components/schemas/DashboardAnnouncementLatest' },
            },
          },
        },
        DashboardSummary: {
          type: 'object',
          properties: {
            votes: { $ref: '#/components/schemas/DashboardVotes' },
            period: { $ref: '#/components/schemas/DashboardPeriod' },
            finance: { $ref: '#/components/schemas/DashboardFinance' },
            community: { $ref: '#/components/schemas/DashboardCommunity' },
            incidents: { $ref: '#/components/schemas/DashboardIncidents' },
            generatedAt: { type: 'string', format: 'date-time' },
            reservations: { $ref: '#/components/schemas/DashboardReservations' },
            announcements: { $ref: '#/components/schemas/DashboardAnnouncements' },
          },
        },

        // --- AI (verificado) -------------------------------------
        AiChatRequest: {
          type: 'object',
          required: ['message'],
          properties: {
            communityId: { type: 'string', format: 'uuid' },
            message: { type: 'string' },
            sessionId: { type: 'string', format: 'uuid', nullable: true },
          },
        },
        AiChatResponse: {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: {
                sessionId: { type: 'string', format: 'uuid' },
                reply: { type: 'string' },
                toolsUsed: { type: 'array', items: { type: 'string' } },
                needsHumanReview: { type: 'boolean' },
              },
            },
          },
        },
        ChatSession: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string', nullable: true },
            communityId: { type: 'string', format: 'uuid', nullable: true },
            model: { type: 'string', example: 'openai/gpt-oss-120b' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        ChatSessionListResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/ChatSession' } },
            meta: { $ref: '#/components/schemas/PaginationMeta' },
          },
        },
        ChatMessageCitation: {
          type: 'object',
          properties: {
            ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
            tool: { type: 'string', example: 'get_announcements' },
          },
        },
        ChatMessage: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            role: { type: 'string', enum: ['user', 'assistant', 'tool', 'system'] },
            content: { type: 'string' },
            toolCalls: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
              nullable: true,
            },
            citations: {
              type: 'array',
              items: { $ref: '#/components/schemas/ChatMessageCitation' },
              nullable: true,
            },
            tokensIn: { type: 'integer', nullable: true },
            tokensOut: { type: 'integer', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ChatMessageListResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/ChatMessage' } },
            meta: { $ref: '#/components/schemas/PaginationMeta' },
          },
        },
        IncidentClassification: {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: {
                category: { $ref: '#/components/schemas/IncidentCategory' },
                priority: { $ref: '#/components/schemas/IncidentPriority' },
                confidence: { type: 'number', format: 'float' },
                needsHumanReview: { type: 'boolean' },
              },
            },
          },
        },
        IncidentDraft: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string' },
            category: { $ref: '#/components/schemas/IncidentCategory' },
            priority: { $ref: '#/components/schemas/IncidentPriority' },
            status: { type: 'string', enum: ['DRAFT', 'CONFIRMED'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Tool: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'get_community' },
            description: { type: 'string' },
            roles: {
              type: 'array',
              items: { type: 'string', enum: ['NEIGHBOR', 'PRESIDENT', 'ADMIN', 'PROVIDER'] },
            },
            requiresCommunity: { type: 'boolean' },
          },
        },
        ToolListResponse: {
          type: 'object',
          properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Tool' } } },
        },
        ToolPreviewResponse: {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: {
                tool: { type: 'string' },
                result: { type: 'object', additionalProperties: true },
              },
            },
          },
        },

        // --- Agents (verificado) ---------------------------------
        Agent: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'community' },
            title: { type: 'string', example: 'Agente de comunidad' },
            description: { type: 'string' },
            roles: {
              type: 'array',
              items: { type: 'string', enum: ['NEIGHBOR', 'PRESIDENT', 'ADMIN', 'PROVIDER'] },
            },
            skills: { type: 'array', items: { type: 'string' } },
          },
        },
        AgentListResponse: {
          type: 'object',
          properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Agent' } } },
        },
        AgentRunResponse: {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: {
                runId: { type: 'string', format: 'uuid' },
                status: { type: 'string', enum: ['COMPLETED', 'FAILED', 'PENDING'] },
                output: { type: 'object', additionalProperties: true },
              },
            },
          },
        },

        // --- MCP ------------------------------------------------
        McpSession: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            communityId: { type: 'string', format: 'uuid' },
            role: { type: 'string', enum: ['NEIGHBOR', 'PRESIDENT', 'ADMIN', 'PROVIDER'] },
            expiresAt: { type: 'string', format: 'date-time' },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'No autenticado (falta token o es inválido)',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Forbidden: {
          description: 'Autenticado pero sin permisos sobre el recurso',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        NotFound: {
          description: 'Recurso no encontrado (o invisible por RLS)',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        RateLimited: {
          description: 'Demasiadas peticiones',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Validation: {
          description: 'Error de validación del cuerpo o query',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Conflict: {
          description: 'Conflicto con el estado actual del recurso',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: [`${cwd}/src/**/routes.ts`, `${cwd}/dist/**/routes.js`],
}

export const swaggerSpec = swaggerJsdoc(options)
