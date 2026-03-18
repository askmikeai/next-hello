# OCI Container Registry repositories
resource "oci_artifacts_container_repository" "api" {
  compartment_id = var.compartment_ocid
  display_name   = "nexthello-api"
  is_public      = false
}

resource "oci_artifacts_container_repository" "whatsapp" {
  compartment_id = var.compartment_ocid
  display_name   = "nexthello-whatsapp"
  is_public      = false
}

resource "oci_artifacts_container_repository" "ui" {
  compartment_id = var.compartment_ocid
  display_name   = "nexthello-ui"
  is_public      = false
}
