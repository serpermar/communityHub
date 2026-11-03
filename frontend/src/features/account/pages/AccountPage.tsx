import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion'
import { ChevronLeft } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  PageHeader,
  TabPanel,
  Tabs,
  useToast,
} from '@/components/ui'
import type { TabItem } from '@/components/ui/Tabs'
import { ApiError } from '@/services/ApiError'
import { useAuth } from '@/context/AuthContext'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { formatDateTime } from '@/utils/format'
import { deleteAvatar, uploadAvatar } from '../api'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { profileSchema, type ProfileForm } from '../schemas'
import { ProfileTab } from '../components/ProfileTab'
import { SecurityTab } from '../components/SecurityTab'
import { SessionsTab } from '../components/SessionsTab'
import { AppearanceTab } from '../components/AppearanceTab'
import styles from './AccountPage.module.css'

type AccountTab = 'profile' | 'security' | 'sessions' | 'appearance'

export function AccountPage() {
  const shouldReduceMotion = useReducedMotion()
  const navigate = useNavigate()
  const { user, logout, reload } = useAuth()
  const { notify } = useToast()
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [avatarLoading, setAvatarLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeTab, setActiveTab] = useState<AccountTab>('profile')

  const tabs: TabItem<AccountTab>[] = [
    { value: 'profile', label: 'Perfil' },
    { value: 'security', label: 'Seguridad' },
    { value: 'sessions', label: 'Sesiones' },
    { value: 'appearance', label: 'Apariencia' },
  ]

  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: user?.fullName ?? '', phone: user?.phone ?? '' },
    mode: 'onTouched',
  })

  const profileLeave = useUnsavedChanges(profileForm.formState.isDirty)

  useEffect(() => {
    profileForm.reset({ fullName: user?.fullName ?? '', phone: user?.phone ?? '' })
  }, [user, profileForm])

  const onAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setAvatarLoading(true)
    try {
      await uploadAvatar(file)
      await reload()
      notify('Avatar actualizado.', 'success')
    } catch (caught) {
      notify(ApiError.from(caught).message, 'error')
    } finally {
      setAvatarLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const onAvatarDelete = async () => {
    setAvatarLoading(true)
    try {
      await deleteAvatar()
      await reload()
      notify('Avatar eliminado.', 'success')
    } catch (caught) {
      notify(ApiError.from(caught).message, 'error')
    } finally {
      setAvatarLoading(false)
    }
  }

  const roleLabel = user?.globalRole === 'ADMIN_SA' ? 'Administrador de plataforma' : 'Usuario'

  // Anotamos con `type Variants` para que `ease` sea un literal válido
  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: shouldReduceMotion ? 0 : 0.1 } },
  }

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 15 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
  }

  const tabVariants: Variants = {
    initial: { opacity: 0, x: shouldReduceMotion ? 0 : -10 },
    animate: { opacity: 1, x: 0, transition: { duration: 0.2 } },
    exit: { opacity: 0, x: shouldReduceMotion ? 0 : 10, transition: { duration: 0.15 } },
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className={styles.page}
    >
      {/* BOTÓN VOLVER REDISEÑADO */}
      <motion.button
        variants={itemVariants}
        type="button"
        onClick={() => navigate(-1)}
        className={styles.backButton}
      >
        <ChevronLeft size={16} />
        Volver
      </motion.button>

      <motion.div variants={itemVariants}>
        <PageHeader title="Mi cuenta" />
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <div className={styles.headerCard}>
            <div className={styles.profileInfo}>
              <div className={styles.avatarLarge}>
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt={user.fullName} className={styles.avatarImg} />
                ) : (
                  (user?.fullName?.[0] || user?.email?.[0] || '?').toUpperCase()
                )}
              </div>
              <div className={styles.profileText}>
                <p className={styles.profileName}>{user?.fullName}</p>
                <div className={styles.profileMeta}>
                  <span>{user?.email}</span>
                  <span className={styles.metaDot}>·</span>
                  <span>{roleLabel}</span>
                  {user?.emailVerifiedAt && (
                    <>
                      <span className={styles.metaDot}>·</span>
                      <Badge tone="green">Verificado</Badge>
                    </>
                  )}
                  {user?.createdAt && (
                    <>
                      <span className={styles.metaDot}>·</span>
                      <span>Miembro desde {formatDateTime(user.createdAt).split(',')[0]}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className={styles.avatarActions}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className={styles.hiddenInput}
                onChange={onAvatarChange}
              />
              <Button
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                loading={avatarLoading}
              >
                Cambiar avatar
              </Button>
              {user?.avatarUrl && (
                <Button size="sm" variant="ghost" onClick={onAvatarDelete} loading={avatarLoading}>
                  Quitar avatar
                </Button>
              )}
            </div>
          </div>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants} className={styles.tabsWrap}>
        <Tabs
          items={tabs}
          value={activeTab}
          onChange={setActiveTab}
          ariaLabel="Secciones de cuenta"
        />
      </motion.div>

      <div className={styles.tabContentWrapper}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial="initial"
            animate="animate"
            exit="exit"
            variants={tabVariants}
          >
            <TabPanel value="profile" active={activeTab}>
              <div className={styles.sectionGap}>
                {/* Quitamos la prop `form` porque ProfileTab no la acepta actualmente */}
                <ProfileTab />
              </div>
            </TabPanel>

            <TabPanel value="security" active={activeTab}>
              <div className={styles.sectionGap}>
                <SecurityTab />
              </div>
            </TabPanel>

            <TabPanel value="sessions" active={activeTab}>
              <div className={styles.sectionGap}>
                <SessionsTab />
              </div>
            </TabPanel>

            <TabPanel value="appearance" active={activeTab}>
              <AppearanceTab onLogout={() => setLogoutOpen(true)} />
            </TabPanel>
          </motion.div>
        </AnimatePresence>
      </div>

      <ConfirmDialog
        open={logoutOpen}
        title="Cerrar sesión"
        description="Se cerrará la sesión en este dispositivo y volverás a la pantalla de acceso."
        confirmLabel="Cerrar sesión"
        onCancel={() => setLogoutOpen(false)}
        onConfirm={() => logout().then(() => navigate('/login', { replace: true }))}
      />

      <ConfirmDialog
        open={profileLeave.blocked}
        title="Cambios sin guardar"
        description="Tienes cambios sin guardar en tu perfil. Si sales ahora, se perderán."
        confirmLabel="Salir sin guardar"
        cancelLabel="Seguir editando"
        onConfirm={profileLeave.confirm}
        onCancel={profileLeave.cancel}
      />
    </motion.div>
  )
}
