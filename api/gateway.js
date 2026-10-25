import { verifyToken } from '@clerk/backend';
import { createGateway } from '../deployment/gateway.mjs';
export default createGateway({ verifyToken });
