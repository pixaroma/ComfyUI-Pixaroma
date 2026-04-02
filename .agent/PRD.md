# PRD: ComfyUI-Pixaroma Project Reorganization
## Overview
Standardize the Pixaroma custom nodes UI to achieve complete visual and architectural consistency across all editors. 
composer, crop, and paint nodes 
nodes will follow a unified pattern using shared components and centralized styling. and will use pixaroma_3d.js as guide for this pattern

## Current State Analysis
### Existing Node Types
1. **3D Builder** (`pixaroma_3d.js`) - ✓ Uses `createDummyWidget()` pattern (reference implementation)
2. **Image Composer** (`pixaroma_composer.js`) - ✗ Uses `createPlaceholder()` pattern
3. **Paint** (`pixaroma_paint.js`) - ✗ Uses `createPlaceholder()` pattern
4. **Image Crop** (`pixaroma_crop.js`) - ✗ Uses `createPlaceholder()` pattern
5. **Image Compare** (`pixaroma_compare.js`) - ✗ Custom canvas with inline CSS
6. **Label** (`pixaroma_label.js`) - ✗ Custom popup with inline CSS
### Problems Identified
- ✗ Inconsistent UI patterns (3 different approaches)
- ✗ CSS duplication across files (compare.js, label.js, each node file)
- ✗ Inconsistent button styles, spacing, and layouts
- ✗ Mixed button labeling conventions
- ✗ Inconsistent preview handling
- ✗ No shared layout structure for editor interfaces
## Goals
### Primary Objectives
1. **Unified Pattern**: All nodes follow `pixaroma_3d.js` pattern using `createDummyWidget()`
2. **Shared Styling**: All CSS extracted to `pixaroma_shared.js`
3. **Consistent Layout**: Header + Sidebar structure for all editors
4. **Reusable Components**: Standardized buttons, sliders, panels
5. **Maintainability**: Single source of truth for styling and patterns
### Success Metrics
- 100% of nodes use `createDummyWidget()`
- Zero CSS duplication across node files
- All editors share identical header/sidebar layout
- Consistent button/slider styling across all nodes
- Reduced codebase size by ~20% (removed duplication)
## Proposed Structure
### 1. Shared CSS Library (`web/js/pixaroma_shared.js`)
[Include the comprehensive CSS classes from my earlier analysis]
### 2. Enhanced `createDummyWidget()` Function
[Include the enhanced version with options]
### 3. Standard Node Pattern Template
[Include the template code]
### 4. Editor Core Structure
[Include the architecture pattern]

