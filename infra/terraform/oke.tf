# OKE cluster
resource "oci_containerengine_cluster" "nexthello" {
  compartment_id     = var.compartment_ocid
  kubernetes_version = var.kubernetes_version
  name               = "nexthello-oke"
  vcn_id             = oci_core_vcn.nexthello.id

  endpoint_config {
    is_public_ip_enabled = true
    subnet_id            = oci_core_subnet.k8s_api.id
  }

  options {
    service_lb_subnet_ids = [oci_core_subnet.lb.id]
  }
}

# Node pool (Ampere A1 Flex — always-free eligible)
data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

resource "oci_containerengine_node_pool" "workers" {
  compartment_id     = var.compartment_ocid
  cluster_id         = oci_containerengine_cluster.nexthello.id
  kubernetes_version = var.kubernetes_version
  name               = "nexthello-workers"

  node_shape = var.node_shape

  node_shape_config {
    ocpus         = var.node_ocpus
    memory_in_gbs = var.node_memory_gb
  }

  node_config_details {
    size = var.node_count

    dynamic "placement_configs" {
      for_each = data.oci_identity_availability_domains.ads.availability_domains
      content {
        availability_domain = placement_configs.value.name
        subnet_id           = oci_core_subnet.worker.id
      }
    }
  }

  node_source_details {
    image_id    = data.oci_core_images.oke_node.images[0].id
    source_type = "IMAGE"
  }

  ssh_public_key = var.ssh_public_key != "" ? var.ssh_public_key : null
}

# Latest OKE-optimized Oracle Linux image for the node shape
data "oci_core_images" "oke_node" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Oracle Linux"
  operating_system_version = "8"
  shape                    = var.node_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"

  filter {
    name   = "display_name"
    values = [".*OKE.*"]
    regex  = true
  }
}
