import { Router } from 'express';
import { AuthMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { WasteManagementService } from '../services/WasteManagementService';
import { asyncHandler } from '../utils/errors';

const router = Router();

// Get inventory status for a branch
router.get('/inventory/:branchId',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin', 'branch_admin']),
  asyncHandler(async (req: any, res) => {
    const { branchId } = req.params;

    // Check branch access permissions
    if (req.user.role === 'branch_admin' && req.user.branchId !== branchId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this branch',
      });
    }

    const inventory = await WasteManagementService.getInventoryStatus(branchId);

    res.json({
      success: true,
      data: { inventory },
    });
  })
);

// Get expiring items for a branch
router.get('/inventory/:branchId/expiring',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin', 'branch_admin']),
  asyncHandler(async (req: any, res) => {
    const { branchId } = req.params;
    const daysAhead = parseInt(req.query.days as string) || 7;

    // Check branch access permissions
    if (req.user.role === 'branch_admin' && req.user.branchId !== branchId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this branch',
      });
    }

    const expiringItems = await WasteManagementService.getExpiringItems(branchId, daysAhead);

    res.json({
      success: true,
      data: { expiringItems },
    });
  })
);

// Create inventory purchase
router.post('/inventory/purchases',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin', 'branch_admin']),
  asyncHandler(async (req: any, res) => {
    const purchaseData = req.body;

    // Check branch access permissions
    if (req.user.role === 'branch_admin' && req.user.branchId !== purchaseData.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this branch',
      });
    }

    // Set tenant ID from user context
    if (req.user.role !== 'super_admin') {
      purchaseData.tenantId = req.user.tenantId;
    }

    const purchase = await WasteManagementService.createInventoryPurchase(purchaseData, req.user.id);

    res.status(201).json({
      success: true,
      message: 'Inventory purchase created successfully',
      data: { purchase },
    });
  })
);

// Create waste record
router.post('/waste-records',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin', 'branch_admin']),
  asyncHandler(async (req: any, res) => {
    const wasteData = req.body;

    // Check branch access permissions
    if (req.user.role === 'branch_admin' && req.user.branchId !== wasteData.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this branch',
      });
    }

    // Set tenant ID from user context
    if (req.user.role !== 'super_admin') {
      wasteData.tenantId = req.user.tenantId;
    }

    const wasteRecord = await WasteManagementService.createWasteRecord(wasteData, req.user.id);

    res.status(201).json({
      success: true,
      message: 'Waste record created successfully',
      data: { wasteRecord },
    });
  })
);

// Get waste analytics for a branch
router.get('/analytics/:branchId',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin', 'branch_admin']),
  asyncHandler(async (req: any, res) => {
    const { branchId } = req.params;
    const { startDate, endDate } = req.query;

    // Check branch access permissions
    if (req.user.role === 'branch_admin' && req.user.branchId !== branchId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this branch',
      });
    }

    const analytics = await WasteManagementService.getWasteAnalytics(
      branchId, 
      startDate as string, 
      endDate as string
    );

    res.json({
      success: true,
      data: analytics,
    });
  })
);

// Create product
router.post('/products',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin']),
  asyncHandler(async (req: any, res) => {
    const productData = req.body;

    // Set tenant ID from user context
    if (req.user.role === 'tenant_admin') {
      productData.tenantId = req.user.tenantId;
    }

    const product = await WasteManagementService.createProduct(productData, req.user.id);

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: { product },
    });
  })
);

// Get products for tenant
router.get('/products',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin', 'branch_admin']),
  asyncHandler(async (req: any, res) => {
    let tenantId = req.query.tenantId as string;

    // Set tenant ID from user context if not super admin
    if (req.user.role !== 'super_admin') {
      tenantId = req.user.tenantId;
    }

    const products = await WasteManagementService.getProducts(tenantId);

    res.json({
      success: true,
      data: { products },
    });
  })
);

// Get units
router.get('/units',
  AuthMiddleware.authenticate,
  asyncHandler(async (req: any, res) => {
    const units = await WasteManagementService.getUnits();

    res.json({
      success: true,
      data: { units },
    });
  })
);

// Get categories
router.get('/categories',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin', 'branch_admin']),
  asyncHandler(async (req: any, res) => {
    let tenantId = req.query.tenantId as string;

    if (req.user.role !== 'super_admin') {
      tenantId = req.user.tenantId;
    }

    const categories = await WasteManagementService.getCategories(tenantId);

    res.json({
      success: true,
      data: { categories },
    });
  })
);

// Get waste categories
router.get('/waste-categories',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin', 'branch_admin']),
  asyncHandler(async (req: any, res) => {
    let tenantId = req.query.tenantId as string;

    if (req.user.role !== 'super_admin') {
      tenantId = req.user.tenantId;
    }

    const wasteCategories = await WasteManagementService.getWasteCategories(tenantId);

    res.json({
      success: true,
      data: { wasteCategories },
    });
  })
);

// Get suppliers
router.get('/suppliers',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin', 'branch_admin']),
  asyncHandler(async (req: any, res) => {
    let tenantId = req.query.tenantId as string;

    if (req.user.role !== 'super_admin') {
      tenantId = req.user.tenantId;
    }

    const suppliers = await WasteManagementService.getSuppliers(tenantId);

    res.json({
      success: true,
      data: { suppliers },
    });
  })
);

export default router;