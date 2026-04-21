import { auditRepository, type ListAuditLogsParams } from "@/repositories/audit.repository.ts";

export const auditService = {
  async list(params: ListAuditLogsParams) {
    return auditRepository.findAll(params);
  },
};
