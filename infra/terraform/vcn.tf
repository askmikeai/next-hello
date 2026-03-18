# VCN for OKE cluster
resource "oci_core_vcn" "nexthello" {
  compartment_id = var.compartment_ocid
  display_name   = "nexthello-vcn"
  cidr_blocks    = ["10.0.0.0/16"]
  dns_label      = "nexthello"
}

resource "oci_core_internet_gateway" "nexthello" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.nexthello.id
  display_name   = "nexthello-igw"
  enabled        = true
}

resource "oci_core_nat_gateway" "nexthello" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.nexthello.id
  display_name   = "nexthello-nat"
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.nexthello.id
  display_name   = "nexthello-public-rt"

  route_rules {
    network_entity_id = oci_core_internet_gateway.nexthello.id
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
  }
}

resource "oci_core_route_table" "private" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.nexthello.id
  display_name   = "nexthello-private-rt"

  route_rules {
    network_entity_id = oci_core_nat_gateway.nexthello.id
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
  }
}

resource "oci_core_security_list" "k8s_api" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.nexthello.id
  display_name   = "nexthello-k8s-api-sl"

  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }

  ingress_security_rules {
    protocol = "6" # TCP
    source   = "0.0.0.0/0"
    tcp_options {
      min = 6443
      max = 6443
    }
  }
}

resource "oci_core_security_list" "worker" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.nexthello.id
  display_name   = "nexthello-worker-sl"

  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }

  ingress_security_rules {
    protocol = "all"
    source   = "10.0.0.0/16"
  }
}

resource "oci_core_security_list" "lb" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.nexthello.id
  display_name   = "nexthello-lb-sl"

  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }

  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 80
      max = 80
    }
  }

  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 443
      max = 443
    }
  }
}

# Subnets
resource "oci_core_subnet" "k8s_api" {
  compartment_id    = var.compartment_ocid
  vcn_id            = oci_core_vcn.nexthello.id
  display_name      = "nexthello-k8s-api-subnet"
  cidr_block        = "10.0.0.0/28"
  route_table_id    = oci_core_route_table.public.id
  security_list_ids = [oci_core_security_list.k8s_api.id]
  dns_label         = "k8sapi"
}

resource "oci_core_subnet" "worker" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.nexthello.id
  display_name               = "nexthello-worker-subnet"
  cidr_block                 = "10.0.1.0/24"
  route_table_id             = oci_core_route_table.private.id
  security_list_ids          = [oci_core_security_list.worker.id]
  prohibit_public_ip_on_vnic = true
  dns_label                  = "workers"
}

resource "oci_core_subnet" "lb" {
  compartment_id    = var.compartment_ocid
  vcn_id            = oci_core_vcn.nexthello.id
  display_name      = "nexthello-lb-subnet"
  cidr_block        = "10.0.2.0/24"
  route_table_id    = oci_core_route_table.public.id
  security_list_ids = [oci_core_security_list.lb.id]
  dns_label         = "lb"
}
