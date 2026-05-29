import { Router } from 'express';
import profileRouter from './account-profile';
import securityRouter from './account-security';

// The account router is split by family across focused modules but
// remains mounted as a single router at `/api/account` (see
// server/routes/index.ts). Both sub-routers register their handlers
// on the combined router below; there are no overlapping paths
// between the two families, so mount order is immaterial.
//
//   - account-profile.ts   : profile management (PATCH /profile/:id,
//                            payment-sync retries)
//   - account-security.ts  : security handshakes (deletion request,
//                            email-change confirmation, password change)
const router = Router();
router.use(profileRouter);
router.use(securityRouter);

export default router;

// Re-export the public contract consumed by unit tests so their
// existing `import ... from '../../server/routes/account'` paths keep
// working after the split.
export {
  SUPPORTED_PREFERRED_LANGUAGES,
  profileUpdateSchema,
} from './account-shared';
export { changePasswordKeyGenerator } from './account-security';
export {
  applyEmailChangeRequestTxn,
  applyAdminProfileEditTxn,
  applyConfirmEmailChangeTxn,
  type AdminProfileEditFieldChange,
  type ConfirmEmailChangeOutcome,
} from '../services/account-lifecycle';
