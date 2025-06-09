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

router.post('/categories',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin']),
  asyncHandler(async (req: any, res) => {
    const categoryData = req.body;

    if (req.user.role === 'tenant_admin') {
      categoryData.tenantId = req.user.tenantId;
    }

    const category = await WasteManagementService.createCategory(categoryData, req.user.id);

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: { category },
    });
  })
);

router.put('/categories/:id',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin']),
  asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const updateData = req.body;

    const category = await WasteManagementService.updateCategory(id, updateData, req.user.id);

    res.json({
      success: true,
      message: 'Category updated successfully',
      data: { category },
    });
  })
);

router.delete('/categories/:id',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin']),
  asyncHandler(async (req: any, res) => {
    const { id } = req.params;

    await WasteManagementService.deleteCategory(id, req.user.id);

    res.json({
      success: true,
      message: 'Category deleted successfully',
    });
  })
);

// Supplier CRUD
router.post('/suppliers',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin']),
  asyncHandler(async (req: any, res) => {
    const supplierData = req.body;

    if (req.user.role === 'tenant_admin') {
      supplierData.tenantId = req.user.tenantId;
    }

    const supplier = await WasteManagementService.createSupplier(supplierData, req.user.id);

    res.status(201).json({
      success: true,
      message: 'Supplier created successfully',
      data: { supplier },
    });
  })
);

router.put('/suppliers/:id',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin']),
  asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const updateData = req.body;

    const supplier = await WasteManagementService.updateSupplier(id, updateData, req.user.id);

    res.json({
      success: true,
      message: 'Supplier updated successfully',
      data: { supplier },
    });
  })
);

router.delete('/suppliers/:id',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin']),
  asyncHandler(async (req: any, res) => {
    const { id } = req.params;

    await WasteManagementService.deleteSupplier(id, req.user.id);

    res.json({
      success: true,
      message: 'Supplier deleted successfully',
    });
  })
);

// Waste Category CRUD
router.post('/waste-categories',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin']),
  asyncHandler(async (req: any, res) => {
    const wasteCategoryData = req.body;

    if (req.user.role === 'tenant_admin') {
      wasteCategoryData.tenantId = req.user.tenantId;
    }

    const wasteCategory = await WasteManagementService.createWasteCategory(wasteCategoryData, req.user.id);

    res.status(201).json({
      success: true,
      message: 'Waste category created successfully',
      data: { wasteCategory },
    });
  })
);

router.put('/waste-categories/:id',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin']),
  asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const updateData = req.body;

    const wasteCategory = await WasteManagementService.updateWasteCategory(id, updateData, req.user.id);

    res.json({
      success: true,
      message: 'Waste category updated successfully',
      data: { wasteCategory },
    });
  })
);

router.delete('/waste-categories/:id',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin']),
  asyncHandler(async (req: any, res) => {
    const { id } = req.params;

    await WasteManagementService.deleteWasteCategory(id, req.user.id);

    res.json({
      success: true,
      message: 'Waste category deleted successfully',
    });
  })
);

// System Settings
router.put('/settings',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin']),
  asyncHandler(async (req: any, res) => {
    const settings = req.body;

    const updatedSettings = await WasteManagementService.updateSystemSettings(settings, req.user.id);

    res.json({
      success: true,
      message: 'System settings updated successfully',
      data: updatedSettings,
    });
  })
);

export default router;